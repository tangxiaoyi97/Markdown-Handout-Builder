#!/usr/bin/env node
/**
 * scripts/render-pdf.mjs
 *
 * 用 Playwright Chromium 打开各主题的 dist/handout[.<theme>].html，切换到
 * 打印媒体（等价于浏览器 Ctrl+P 的渲染路径），生成对应 PDF。
 *
 * 原则：每份 PDF 只能从对应的同一份 HTML 打印生成，
 * 不从 Markdown 直接生成，也不使用第二套 HTML/模板。
 *
 * 页眉 / 页脚 / 页码（book.yml → pdf.header_footer，默认开启）：
 *   Chromium 不支持 CSS @page 边距盒（@top-center 等），页眉页脚只能
 *   由打印管线绘制在页边距区域。正文内容仍 100% 来自 handout.html。
 *   封面页默认不显示页眉页脚（pdf.cover_header_footer 可改）。
 *
 * 目录页码（book.yml → pdf.toc_page_numbers，默认开启）：
 *   两遍打印。第一遍生成 PDF 并读取其大纲（outline）得到每个标题的
 *   真实页码；把页码注入目录的 .toc-page 占位符（同一行内追加，不改变
 *   分页），再打印第二遍。
 *
 * 后处理（pdf-lib）：
 *   1. 写入 PDF 元数据（Title/Author/Subject/Keywords/Creator/Language/日期）；
 *   2. 封面/封底页覆盖为无页眉页脚版本（整页图层叠加，书签与内链不受影响）。
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import YAML from "yaml";

const toPosix = (p) => p.split(path.sep).join("/");
const rel = (p) => toPosix(path.relative(process.cwd(), p));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveConfigPath() {
  const i = process.argv.indexOf("--config");
  if (i !== -1) {
    const value = process.argv[i + 1];
    if (!value) {
      console.error("Error: --config requires a file path, e.g. --config book.yml");
      process.exit(1);
    }
    return path.resolve(process.cwd(), value);
  }
  return path.resolve(process.cwd(), "book.yml");
}

/* ---------- 读取配置 ---------- */

const configPath = resolveConfigPath();
const baseDir = path.dirname(configPath);

if (!fs.existsSync(configPath)) {
  console.error(`Error: config file not found: ${configPath}`);
  process.exit(1);
}

let book;
try {
  book = YAML.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(`Error: failed to parse ${path.basename(configPath)}: ${err.message}`);
  process.exit(1);
}

const htmlOut = path.resolve(baseDir, book?.output?.html ?? "dist/handout.html");
const pdfOut = path.resolve(baseDir, book?.output?.pdf ?? "dist/handout.pdf");

const title = book?.title ? String(book.title) : "";
const subtitle = book?.subtitle ? String(book.subtitle) : "";
const language = book?.language ? String(book.language) : "zh-CN";
const rawDate = book?.date ? String(book.date) : "";
const baseDateFormat = book?.date_format ? String(book.date_format) : "YYYY-MM-DD";
const authors = Array.isArray(book?.authors)
  ? book.authors.map(String)
  : book?.authors
    ? [String(book.authors)]
    : [];
const keywords = Array.isArray(book?.keywords) ? book.keywords.map(String) : [];
const bookVersion =
  book?.version !== undefined && book?.version !== null ? String(book.version) : "";

// 构建溯源：{{commit}}（与 build.mjs 同一规则，cwd = 笔记仓库）
function resolveGitCommit(dir) {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    if (!hash) return "";
    const dirty = execSync("git status --porcelain", {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "";
  }
}
const gitCommit = resolveGitCommit(baseDir);

const pdfBase = book?.pdf ?? {};
const coverBase = book?.cover ?? {};
const backBase = book?.back_cover ?? {};

/* ---------- 主题（与 build.mjs 相同的规则） ---------- */

function normalizeThemes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { name: "", label: "", isDefault: true, style: {}, cover: {}, back_cover: {}, pdf: {} }
    ];
  }
  let defaultIndex = raw.findIndex((t) => t && t.default === true);
  if (defaultIndex === -1) defaultIndex = 0;
  return raw.map((t, i) => {
    const name = String(t?.name ?? `theme${i + 1}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      console.error(
        `Error: invalid theme name ${JSON.stringify(name)} — ` +
          `must match [A-Za-z0-9][A-Za-z0-9_-]* (it is used in output filenames).`
      );
      process.exit(1);
    }
    return {
      name,
      label: String(t?.label ?? t?.name ?? `theme${i + 1}`),
      isDefault: i === defaultIndex,
      style: t?.style ?? {},
      cover: t?.cover ?? {},
      back_cover: t?.back_cover ?? {},
      pdf: t?.pdf ?? {}
    };
  });
}
const themes = normalizeThemes(book?.themes);

function variantPath(basePath, theme) {
  if (theme.isDefault) return basePath;
  const ext = path.extname(basePath);
  return path.join(
    path.dirname(basePath),
    `${path.basename(basePath, ext)}.${theme.name}${ext}`
  );
}

/* ---------- 工具 ---------- */

function marginParts(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" };
  }
  const [a, b = a, c = a, d = b] = parts;
  return { top: a, right: b, bottom: c, left: d };
}

function sanitizeCssValue(value) {
  return String(value).replace(/[{}<>;]/g, "").trim();
}

// pdf 配置合并：header / footer / page_numbers / header_footer_style
// 为嵌套对象，主题只写其中一个键时不应丢掉基础配置的其余键
function mergePdfCfg(base, override) {
  const merged = { ...(base ?? {}), ...(override ?? {}) };
  for (const key of ["page_numbers", "header", "footer", "header_footer_style"]) {
    if (base?.[key] || override?.[key]) {
      merged[key] = { ...(base?.[key] ?? {}), ...(override?.[key] ?? {}) };
    }
  }
  return merged;
}

function cssLengthToMm(value) {
  const m = String(value ?? "").trim().match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  const per = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
  return n * (per[(m[2] ?? "mm").toLowerCase()] ?? 1);
}

// 页眉/页脚在页边距区内的垂直落点：取对应边距的 38%，钳制在 3–8mm。
// 让文字离纸边有呼吸感、又不贴近正文；可用 header_footer_style.offset 覆盖。
function hfOffset(marginValue, fallbackMm) {
  const mm = cssLengthToMm(marginValue) ?? fallbackMm;
  return `${Math.min(8, Math.max(3, mm * 0.38)).toFixed(1)}mm`;
}

function dateParts(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})(?:-?(\d{2})(?:-?(\d{2}))?)?/);
  if (!match) return null;
  return {
    YYYY: match[1],
    YY: match[1].slice(-2),
    MM: match[2] ?? "01",
    DD: match[3] ?? "01"
  };
}

function formatDate(value, format = "YYYY-MM-DD") {
  const parts = dateParts(value);
  if (!parts) return String(value ?? "");

  const normalized = String(format || "YYYY-MM-DD").toLowerCase();
  const presets = {
    iso: "YYYY-MM-DD",
    "yyyy-mm-dd": "YYYY-MM-DD",
    yyyymmdd: "YYYYMMDD",
    yymmdd: "YYMMDD",
    "yyyy/mm/dd": "YYYY/MM/DD",
    "yy/mm/dd": "YY/MM/DD",
    "yyyy.mm.dd": "YYYY.MM.DD",
    "yy.mm.dd": "YY.MM.DD"
  };
  const pattern = presets[normalized] ?? String(format || "YYYY-MM-DD");

  return pattern
    .replaceAll("YYYY", parts.YYYY)
    .replaceAll("yyyy", parts.YYYY)
    .replaceAll("YY", parts.YY)
    .replaceAll("yy", parts.YY)
    .replaceAll("MM", parts.MM)
    .replaceAll("mm", parts.MM)
    .replaceAll("DD", parts.DD)
    .replaceAll("dd", parts.DD);
}

function normalizePageNumberFormat(value) {
  const raw = String(value ?? "{{page}} / {{total}}").trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  if (["x", "page", "{{page}}"].includes(normalized)) return "{{page}}";
  if (["x/x", "page/total", "{{page}}/{{total}}"].includes(normalized)) {
    return "{{page}} / {{total}}";
  }
  if (["xofy", "pageoftotal", "page-of-total"].includes(normalized)) {
    return "{{page}} of {{total}}";
  }
  return raw;
}

function renderHeaderFooterContent(template, values) {
  return String(template ?? "").replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (key === "page") return '<span class="pageNumber"></span>';
    if (key === "total") return '<span class="totalPages"></span>';
    return Object.hasOwn(values, key) ? escapeHtml(values[key]) : whole;
  });
}

function slotTemplate(slots, values, style) {
  const cellStyle = "min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;";
  const padding = escapeHtml(style.padding);
  const fontFamily = escapeHtml(style.fontFamily);
  const fontSize = escapeHtml(style.fontSize);
  const color = escapeHtml(style.color);
  return (
    `<div style="width:100%; box-sizing:border-box; padding:${padding}; ` +
    `font-family:${fontFamily}; font-size:${fontSize}; color:${color}; ` +
    `letter-spacing:0.02em; display:flex; align-items:baseline; gap:8px;">` +
    `<span style="flex:1; text-align:left; ${cellStyle}">${renderHeaderFooterContent(slots.left, values)}</span>` +
    `<span style="flex:1; text-align:center; ${cellStyle}">${renderHeaderFooterContent(slots.center, values)}</span>` +
    `<span style="flex:1; text-align:right; ${cellStyle}">${renderHeaderFooterContent(slots.right, values)}</span>` +
    "</div>"
  );
}

function buildHeaderFooterTemplates(pdfCfg, theme, pageMargin) {
  const pageNumbers = pdfCfg.page_numbers ?? {};
  const pageFormat = normalizePageNumberFormat(pageNumbers.format ?? "{{page}} / {{total}}");
  const displayDate = formatDate(rawDate, pdfCfg.date_format ?? baseDateFormat);
  const values = {
    title,
    subtitle,
    authors: authors.join(", "),
    author: authors[0] ?? "",
    date: displayDate,
    rawDate,
    version: bookVersion,
    commit: gitCommit,
    lang: language,
    theme: theme.label || theme.name || ""
  };

  const styleCfg = pdfCfg.header_footer_style ?? {};
  const style = {
    fontFamily: sanitizeCssValue(styleCfg.font_family ?? hfFontFamily),
    fontSize: sanitizeCssValue(styleCfg.font_size ?? "8.5px"),
    color: sanitizeCssValue(styleCfg.color ?? "#8a919a")
  };

  // 垂直落点：默认按边距比例计算；header_footer_style.offset 统一覆盖
  const offsetOverride = styleCfg.offset ? sanitizeCssValue(styleCfg.offset) : null;
  const headerPadTop = offsetOverride ?? hfOffset(pageMargin.top, 18);
  const footerPadBottom = offsetOverride ?? hfOffset(pageMargin.bottom, 20);
  const left = sanitizeCssValue(pageMargin.left);
  const right = sanitizeCssValue(pageMargin.right);

  const headerSlots = {
    left: "{{title}}",
    center: "",
    right: "{{date}}",
    ...(pdfCfg.header ?? {})
  };
  const footerSlots = {
    left: "",
    center: pageFormat,
    right: "",
    ...(pdfCfg.footer ?? {})
  };

  return {
    headerTemplate: slotTemplate(headerSlots, values, {
      ...style,
      padding: `${headerPadTop} ${right} 0 ${left}`
    }),
    footerTemplate: slotTemplate(footerSlots, values, {
      ...style,
      padding: `0 ${right} ${footerPadBottom} ${left}`
    })
  };
}

const hfFontFamily =
  "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, " +
  "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";

/* ---------- 目录页码：解析第一遍 PDF 的大纲 ---------- */

async function resolveTocPageNumbers(pdfBuffer, page) {
  let getDocument;
  try {
    ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch (err) {
    console.warn(`Warning: cannot load pdfjs-dist (${err.message}); skipping TOC page numbers.`);
    return null;
  }

  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0
  });

  const doc = await loadingTask.promise;
  try {
    const outline = await doc.getOutline();
    if (!outline || outline.length === 0) return null;

    // 展平为文档顺序（与 DOM 中 h1..h6 的顺序一致）
    const flat = [];
    (function walk(items) {
      for (const item of items) {
        flat.push(item);
        if (item.items?.length) walk(item.items);
      }
    })(outline);

    const outlineEntries = [];
    for (const item of flat) {
      let dest = item.dest;
      if (typeof dest === "string") dest = await doc.getDestination(dest);
      let pageNo = null;
      if (Array.isArray(dest) && dest[0]) {
        try {
          pageNo = (await doc.getPageIndex(dest[0])) + 1;
        } catch {
          // 无法解析该条目的页码，跳过
        }
      }
      outlineEntries.push({ title: item.title ?? "", pageNo });
    }

    const domHeadings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) => ({
        id: h.id || "",
        text: (h.textContent || "").trim()
      }))
    );

    const norm = (s) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    const result = [];

    if (domHeadings.length === outlineEntries.length) {
      // 数量一致：按顺序一一对应
      domHeadings.forEach((h, i) => {
        const o = outlineEntries[i];
        if (h.id && o.pageNo) result.push({ id: h.id, pageNo: o.pageNo });
      });
    } else {
      // 数量不一致：按标题文本贪心对齐
      let j = 0;
      for (const h of domHeadings) {
        let k = j;
        while (k < outlineEntries.length && norm(outlineEntries[k].title) !== norm(h.text)) k++;
        if (k >= outlineEntries.length) continue;
        if (h.id && outlineEntries[k].pageNo) {
          result.push({ id: h.id, pageNo: outlineEntries[k].pageNo });
        }
        j = k + 1;
      }
    }

    return result;
  } finally {
    await loadingTask.destroy();
  }
}

/* ---------- 后处理：元数据 + 封面/封底无页眉页脚 ---------- */

async function postProcessPdf(filePath, { plainBytes, cleanIndexes, themeLabel, pageBackground }) {
  let PDFDocument, rgb, PDFName, PDFArray, PDFRef, PDFRawStream;
  try {
    ({ PDFDocument, rgb, PDFName, PDFArray, PDFRef, PDFRawStream } = await import("pdf-lib"));
  } catch (err) {
    console.warn(`Warning: cannot load pdf-lib (${err.message}); skipping PDF post-processing.`);
    return;
  }

  const doc = await PDFDocument.load(fs.readFileSync(filePath), { updateMetadata: false });

  // ---- 统一页面基底色（含页边距区） ----
  // Chromium 打印时先用页面"基底色"填满整页（color-scheme: dark 下固定为
  // #121212），再在内容区上画 body 背景——深色主题的页边距因此出现色差，
  // 且该基底色无法用 CSS 或 CDP 改变。修复：解压每页第一个内容流，把
  // 开头的基底填充指令（颜色对 + 整页矩形 + fill）的颜色改写为打印态的
  // body 背景色。结构化匹配、只改第一处，正文与页眉页脚不受影响。
  if (pageBackground) {
    const comp = (v) => (v / 255).toFixed(4).replace(/^0\./, ".");
    const bgColor = `${comp(pageBackground.r)} ${comp(pageBackground.g)} ${comp(pageBackground.b)}`;
    // 基底填充的指纹：前置 cm 平移为 0 0（覆盖整页）。浅色主题下第一条
    // 填充是 body 背景（带页边距平移的内容盒），不能误改写——那会变成
    // 同色空操作，真正的页边距问题被掩盖。
    const BASE_FILL_RE =
      /(q\n[\d.]+ 0 0 [\d.]+ 0 0 cm\n)([\d.]+ [\d.]+ [\d.]+ RG [\d.]+ [\d.]+ [\d.]+ rg)(?=\n\/G\d+ gs\n(?:\/Document <<\/MCID \d+ >>BDC\n)?0 0 [\d.]+ [\d.]+ re\nf)/;
    const contentsKey = PDFName.of("Contents");
    let restyled = 0;
    const pages = doc.getPages();

    for (const page of pages) {
      let first = page.node.get(contentsKey);
      if (first instanceof PDFArray) first = first.get(0);
      if (!(first instanceof PDFRef)) continue;
      const stream = doc.context.lookup(first);
      if (!(stream instanceof PDFRawStream)) continue;

      let inflated;
      try {
        inflated = zlib.inflateSync(Buffer.from(stream.contents));
      } catch {
        continue; // 非 Flate 压缩，跳过
      }

      const text = inflated.toString("latin1");
      const head = text.slice(0, 600);
      let newText;

      if (BASE_FILL_RE.test(head)) {
        // 深色 color-scheme：Chromium 画了基底填充（如 #121212），改写其颜色
        newText =
          head.replace(BASE_FILL_RE, `$1${bgColor} RG ${bgColor} rg`) + text.slice(600);
      } else {
        // 浅色 color-scheme：Chromium 不绘制白色基底（页边距=纸色）。
        // 在内容流最前插入一条 body 色整页填充——此时没有基底会盖住它，
        // 插入即最底层，页边距与正文底色统一（如 sepia 纸感主题）。
        const { width, height } = page.getSize();
        newText =
          `q ${bgColor} rg 0 0 ${width.toFixed(2)} ${height.toFixed(2)} re f Q\n` + text;
      }

      const deflated = zlib.deflateSync(Buffer.from(newText, "latin1"));
      const dict = stream.dict.clone(doc.context);
      dict.set(PDFName.of("Length"), doc.context.obj(deflated.length));
      doc.context.assign(first, PDFRawStream.of(dict, new Uint8Array(deflated)));
      restyled += 1;
    }

    if (restyled === 0) {
      // Chromium 若更改了内容流的生成格式，这里会失配——提醒而不是静默退化
      console.warn(
        "Warning: could not restyle the page base background; " +
          "page margins may differ slightly from the theme background color."
      );
    }
  }

  // ---- 元数据 ----
  const docTitle = themeLabel ? `${title} – ${themeLabel}` : title;
  if (docTitle) doc.setTitle(docTitle);
  if (authors.length > 0) doc.setAuthor(authors.join(", "));
  if (subtitle) doc.setSubject(subtitle);
  if (keywords.length > 0) doc.setKeywords(keywords);
  doc.setCreator("Markdown Handout Builder");
  doc.setProducer("Chromium (Playwright) + pdf-lib");
  if (language) doc.setLanguage(language);
  const created = rawDate ? new Date(rawDate) : new Date();
  if (!Number.isNaN(created.getTime())) doc.setCreationDate(created);
  doc.setModificationDate(new Date());

  // ---- 封面 / 封底：整页叠加无页眉页脚版本 ----
  // Chromium 的页眉页脚画在每一页且无法按页关闭（封面/封底是 margin:0 的
  // 全出血页，页眉页脚会叠在背景上）。用无页眉版的同一页整页覆盖，
  // 正文内容流不动，书签、内部链接、目录页码全部保留，渐变背景也干净。
  if (plainBytes && cleanIndexes?.length > 0) {
    const count = doc.getPageCount();
    const targets = [
      ...new Set(
        cleanIndexes.map((i) => (i < 0 ? count + i : i)).filter((i) => i >= 0 && i < count)
      )
    ];
    if (targets.length > 0) {
      const embedded = await doc.embedPdf(plainBytes, targets);
      targets.forEach((pageIndex, i) => {
        const page = doc.getPage(pageIndex);
        const { width, height } = page.getSize();
        // 白色底防止透出下层，再叠无页眉版的同一页
        page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
        page.drawPage(embedded[i], { x: 0, y: 0, width, height });
      });
    }
  }

  fs.writeFileSync(filePath, await doc.save());
}

async function assembleWithExcludedPages({ numberedBytes, plainBytes, prependCover, appendBackCover }) {
  let PDFDocument;
  try {
    ({ PDFDocument } = await import("pdf-lib"));
  } catch (err) {
    throw new Error(`Cannot assemble excluded cover/back-cover pages: ${err.message}`);
  }

  const doc = await PDFDocument.load(numberedBytes, { updateMetadata: false });
  const plain = await PDFDocument.load(plainBytes, { updateMetadata: false });
  const plainPageCount = plain.getPageCount();

  if (prependCover && plainPageCount > 0) {
    const [coverPage] = await doc.copyPages(plain, [0]);
    doc.insertPage(0, coverPage);
  }

  if (appendBackCover && plainPageCount > 0) {
    const [backPage] = await doc.copyPages(plain, [plainPageCount - 1]);
    doc.addPage(backPage);
  }

  return doc.save();
}

async function preparePage(browser, htmlPath) {
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 720
    }
  });

  await page.goto(pathToFileURL(htmlPath).href, {
    waitUntil: "networkidle"
  });

  await page.emulateMedia({ media: "print" });
  // 标记"官方 PDF 管线"：隐藏网页打印专用的运行页眉（<thead> 重复头），
  // 官方页眉由 Chromium headerTemplate 绘制在页边距区，避免双重页眉
  await page.evaluate(() => document.documentElement.classList.add("mhb-pdf"));
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function applyNumberingDomAdjustments(page, { removeCover, removeBackCover, firstPageMargin }) {
  await page.evaluate(
    ({ removeCover, removeBackCover, firstPageMargin }) => {
      if (removeCover) document.getElementById("cover")?.remove();
      if (removeBackCover) document.getElementById("back-cover")?.remove();

      if (removeCover) {
        const style = document.createElement("style");
        style.setAttribute("data-mhb-page-numbering", "true");
        style.textContent = `@page :first { margin: ${firstPageMargin}; }`;
        document.head.appendChild(style);
      }
    },
    { removeCover, removeBackCover, firstPageMargin }
  );
}

async function pageBackgroundFrom(page) {
  const bodyBgRaw = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor
  );
  const bgMatch = String(bodyBgRaw).match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/
  );
  if (bgMatch && bgMatch[4] !== "0") {
    const [r, g, b] = [Number(bgMatch[1]), Number(bgMatch[2]), Number(bgMatch[3])];
    if (!(r === 255 && g === 255 && b === 255)) return { r, g, b };
  }
  return null;
}

async function injectTocPageNumbers(page, pdfOptions) {
  const firstPass = await page.pdf(pdfOptions);

  let entries = null;
  try {
    entries = await resolveTocPageNumbers(firstPass, page);
  } catch (err) {
    console.warn(`Warning: failed to resolve TOC page numbers: ${err.message}`);
  }

  if (entries && entries.length > 0) {
    await page.evaluate((list) => {
      document.body.classList.add("toc-has-pages");
      for (const { id, pageNo } of list) {
        const target = document.querySelector(
          `.toc-page[data-target="${CSS.escape(id)}"]`
        );
        if (target) target.textContent = String(pageNo);
      }
    }, entries);
  } else {
    console.warn("Warning: TOC page numbers unavailable; generating PDF without them.");
  }
}

/* ---------- 打印管线 ---------- */

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error("Error: failed to launch Playwright Chromium.");
  console.error(err.message);
  console.error(
    "If the browser is not installed yet, run: npx markdown-handout-builder install-browser"
  );
  process.exit(1);
}

try {
  for (const theme of themes) {
    const pdfCfg = mergePdfCfg(pdfBase, theme.pdf);
    const coverCfg = { ...coverBase, ...theme.cover };
    const backCfg = { ...backBase, ...theme.back_cover };

    const withHeaderFooter = pdfCfg.header_footer ?? true;
    const withTocPageNumbers = pdfCfg.toc_page_numbers ?? true;
    const coverHeaderFooter = pdfCfg.cover_header_footer ?? false;
    const coverEnabled = coverCfg.enabled ?? true;
    const backCoverEnabled = backCfg.enabled ?? false;

    const htmlPath = variantPath(htmlOut, theme);
    const pdfPath = variantPath(pdfOut, theme);

    if (!fs.existsSync(htmlPath)) {
      console.error(`Error: ${rel(htmlPath)} not found. Run "npm run build" first.`);
      process.exit(1);
    }

    const pageMargin = marginParts(pdfCfg.margin ?? "18mm 16mm 20mm 16mm");
    const { headerTemplate, footerTemplate } = buildHeaderFooterTemplates(
      pdfCfg,
      theme,
      pageMargin
    );
    const pageNumberCfg = pdfCfg.page_numbers ?? {};
    const countCover = pageNumberCfg.count_cover ?? true;
    const countBackCover = pageNumberCfg.count_back_cover ?? true;
    const excludeCoverFromNumbering = Boolean(coverEnabled && !countCover);
    const excludeBackFromNumbering = Boolean(backCoverEnabled && !countBackCover);
    const useNumberedSubset =
      (excludeCoverFromNumbering || excludeBackFromNumbering) &&
      (withHeaderFooter || withTocPageNumbers);

    if (withHeaderFooter && coverHeaderFooter && excludeCoverFromNumbering) {
      console.warn(
        "Warning: pdf.cover_header_footer is ignored when pdf.page_numbers.count_cover is false."
      );
    }

    const basePdfOptions = {
      preferCSSPageSize: true, // 使用 print.css 中的 @page 尺寸与边距
      printBackground: true,
      tagged: true, // 生成带结构标签的 PDF（可访问性更好；outline 依赖它）
      outline: true // 由标题生成 PDF 书签，同时用于解析目录页码
    };
    const pdfOptions = {
      ...basePdfOptions,
      displayHeaderFooter: withHeaderFooter
    };
    if (withHeaderFooter) {
      pdfOptions.headerTemplate = headerTemplate;
      pdfOptions.footerTemplate = footerTemplate;
    }

    const cleanIndexes = [];
    if (withHeaderFooter) {
      if (coverEnabled && countCover && !coverHeaderFooter) cleanIndexes.push(0);
      if (backCoverEnabled && countBackCover) cleanIndexes.push(-1); // -1 = 最后一页
    }

    let plainBytes = null;
    if (useNumberedSubset || cleanIndexes.length > 0) {
      const plainPage = await preparePage(browser, htmlPath);
      plainBytes = await plainPage.pdf({
        ...basePdfOptions,
        displayHeaderFooter: false
      });
      await plainPage.close();
    }

    const page = await preparePage(browser, htmlPath);
    if (useNumberedSubset) {
      await applyNumberingDomAdjustments(page, {
        removeCover: excludeCoverFromNumbering,
        removeBackCover: excludeBackFromNumbering,
        firstPageMargin: sanitizeCssValue(pdfCfg.margin ?? "18mm 16mm 20mm 16mm")
      });
    }

    // 读取打印态的 body 背景色；非白色主题需要在后处理时统一页面基底色
    const pageBackground = await pageBackgroundFrom(page);

    if (withTocPageNumbers) await injectTocPageNumbers(page, pdfOptions);

    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

    if (useNumberedSubset) {
      const numberedBytes = await page.pdf(pdfOptions);
      const assembledBytes = await assembleWithExcludedPages({
        numberedBytes,
        plainBytes,
        prependCover: excludeCoverFromNumbering,
        appendBackCover: excludeBackFromNumbering
      });
      fs.writeFileSync(pdfPath, assembledBytes);
    } else {
      // 最终一遍：写出该主题的 PDF
      await page.pdf({
        ...pdfOptions,
        path: pdfPath
      });
    }

    await postProcessPdf(pdfPath, {
      plainBytes,
      cleanIndexes,
      themeLabel: theme.isDefault ? "" : theme.label || theme.name,
      pageBackground
    });

    await page.close();
    console.log(`Generated ${rel(pdfPath)}`);
  }
} finally {
  await browser.close();
}
