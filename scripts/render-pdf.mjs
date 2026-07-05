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
const date = book?.date ? String(book.date) : "";
const authors = Array.isArray(book?.authors)
  ? book.authors.map(String)
  : book?.authors
    ? [String(book.authors)]
    : [];
const keywords = Array.isArray(book?.keywords) ? book.keywords.map(String) : [];

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
    const BASE_FILL_RE =
      /[\d.]+ [\d.]+ [\d.]+ RG [\d.]+ [\d.]+ [\d.]+ rg(?=\n\/G\d+ gs\n(?:\/Document <<\/MCID \d+ >>BDC\n)?0 0 [\d.]+ [\d.]+ re\nf)/;
    const contentsKey = PDFName.of("Contents");
    let recolored = 0;

    for (const page of doc.getPages()) {
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
      if (!BASE_FILL_RE.test(head)) continue;

      const newText =
        head.replace(BASE_FILL_RE, `${bgColor} RG ${bgColor} rg`) + text.slice(600);
      const deflated = zlib.deflateSync(Buffer.from(newText, "latin1"));

      const dict = stream.dict.clone(doc.context);
      dict.set(PDFName.of("Length"), doc.context.obj(deflated.length));
      doc.context.assign(first, PDFRawStream.of(dict, new Uint8Array(deflated)));
      recolored += 1;
    }

    if (recolored === 0) {
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
  doc.setCreator("markdown-handout-builder");
  doc.setProducer("Chromium (Playwright) + pdf-lib");
  if (language) doc.setLanguage(language);
  const created = date ? new Date(date) : new Date();
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
    const pdfCfg = { ...pdfBase, ...theme.pdf };
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
    const hfPadding = `0 ${pageMargin.right} 0 ${pageMargin.left}`;

    const headerTemplate =
      `<div style="width:100%; box-sizing:border-box; padding:${hfPadding}; ` +
      `font-family:${hfFontFamily}; font-size:8.5px; color:#8a919a; ` +
      `display:flex; justify-content:space-between;">` +
      `<span>${escapeHtml(title)}</span>` +
      `<span>${escapeHtml(date)}</span>` +
      `</div>`;

    const footerTemplate =
      `<div style="width:100%; box-sizing:border-box; padding:${hfPadding}; ` +
      `font-family:${hfFontFamily}; font-size:8.5px; color:#8a919a; text-align:center;">` +
      `<span class="pageNumber"></span> / <span class="totalPages"></span>` +
      `</div>`;

    const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 720
      }
    });

    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: "networkidle"
    });

    // 模拟浏览器打印（Ctrl+P 使用的 media: print 渲染路径）
    await page.emulateMedia({ media: "print" });

    // 等字体加载完成，避免公式 / 中文字形缺失
    await page.evaluate(() => document.fonts.ready);

    // 读取打印态的 body 背景色；非白色主题需要在后处理时统一页面基底色
    const bodyBgRaw = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    let pageBackground = null;
    const bgMatch = String(bodyBgRaw).match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/
    );
    if (bgMatch && bgMatch[4] !== "0") {
      const [r, g, b] = [Number(bgMatch[1]), Number(bgMatch[2]), Number(bgMatch[3])];
      if (!(r === 255 && g === 255 && b === 255)) pageBackground = { r, g, b };
    }

    const pdfOptions = {
      preferCSSPageSize: true, // 使用 print.css 中的 @page 尺寸与边距
      printBackground: true,
      displayHeaderFooter: withHeaderFooter,
      tagged: true, // 生成带结构标签的 PDF（可访问性更好；outline 依赖它）
      outline: true // 由标题生成 PDF 书签，同时用于解析目录页码
    };
    if (withHeaderFooter) {
      pdfOptions.headerTemplate = headerTemplate;
      pdfOptions.footerTemplate = footerTemplate;
    }

    if (withTocPageNumbers) {
      // 第一遍：拿到每个标题的真实页码
      const firstPass = await page.pdf(pdfOptions);

      let entries = null;
      try {
        entries = await resolveTocPageNumbers(firstPass, page);
      } catch (err) {
        console.warn(`Warning: failed to resolve TOC page numbers: ${err.message}`);
      }

      if (entries && entries.length > 0) {
        // 注入页码。页码追加在目录同一行内，不改变行数和分页，
        // 因此第一遍得到的页码在第二遍中仍然有效。
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

    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

    // 最终一遍：写出该主题的 PDF
    await page.pdf({
      ...pdfOptions,
      path: pdfPath
    });

    // 封面（默认）与封底（启用时）不显示页眉页脚
    const cleanIndexes = [];
    if (withHeaderFooter) {
      if (coverEnabled && !coverHeaderFooter) cleanIndexes.push(0);
      if (backCoverEnabled) cleanIndexes.push(-1); // -1 = 最后一页
    }
    const plainBytes =
      cleanIndexes.length > 0
        ? await page.pdf({ ...pdfOptions, displayHeaderFooter: false })
        : null;

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
