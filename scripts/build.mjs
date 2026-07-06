#!/usr/bin/env node
/**
 * scripts/build.mjs
 *
 * 按 book.yml 的 chapters 顺序渲染 Markdown，生成：
 *   dist/handout.html          —— 唯一 HTML 渲染源（print.css + KaTeX CSS 内联）
 *   dist/handout.<theme>.html  —— 其他主题的变体（配置 themes 时）
 *   dist/index.html            —— GitHub Pages 首页（含各主题入口）
 * 并把 notes/assets 与 KaTeX 字体复制到 dist/。
 *
 * PDF 不在这里生成：render-pdf.mjs 会打开各主题 HTML 打印。
 *
 * 图片扩展语法（见 WRITING_RULES.md）：
 *   ![alt|300](./assets/a.png)        指定宽度 300px（Obsidian 同款）
 *   ![alt|300x200](./assets/a.png)    指定宽高
 *   ![alt](./assets/a.png "图注")     独立成段的图片包成 <figure>，title 变成 <figcaption>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import markdownItAnchorModule from "markdown-it-anchor";
import markdownItFootnoteModule from "markdown-it-footnote";
import markdownItMarkModule from "markdown-it-mark";
import markdownItKatexModule from "@vscode/markdown-it-katex";
import YAML from "yaml";

const require = createRequire(import.meta.url);

// 兼容 CJS/ESM 双格式导出
const interop = (mod) =>
  mod && typeof mod === "object" && "default" in mod ? mod.default : mod;

const anchorPlugin = interop(markdownItAnchorModule);
const footnotePlugin = interop(markdownItFootnoteModule);
const markPlugin = interop(markdownItMarkModule);
const katexPlugin = interop(markdownItKatexModule);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(scriptDir, "..");
const templatesDir = path.join(toolRoot, "templates");

const toPosix = (p) => p.split(path.sep).join("/");

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

if (!book || !Array.isArray(book.chapters) || book.chapters.length === 0) {
  console.error(
    `Error: "chapters" in ${path.basename(configPath)} must be a non-empty array. ` +
      `Run "npm run check" for details.`
  );
  process.exit(1);
}

const title = book.title ? String(book.title) : "Untitled Handout";
const subtitle = book.subtitle ? String(book.subtitle) : "";
const language = book.language ? String(book.language) : "zh-CN";
const rawDate = book.date ? String(book.date) : new Date().toISOString().slice(0, 10);
const dateFormat = book.date_format ? String(book.date_format) : "YYYY-MM-DD";
const authors = Array.isArray(book.authors)
  ? book.authors.map(String)
  : book.authors
    ? [String(book.authors)]
    : [];
const authorsText = authors.join(", ");
const date = formatDate(rawDate, dateFormat);

const htmlOut = path.resolve(baseDir, book.output?.html ?? "dist/handout.html");
const pdfOut = path.resolve(baseDir, book.output?.pdf ?? "dist/handout.pdf");
const distDir = path.dirname(htmlOut);
const notesDir = path.join(baseDir, "notes");

/* ---------- 可选配置：目录 / 样式 / PDF / 封面封底 / 主题 ---------- */

const tocCfg = book.toc ?? {};
const tocEnabled = tocCfg.enabled ?? true;
const tocTitle = tocCfg.title ? String(tocCfg.title) : "目录";
const tocDepth = Math.min(3, Math.max(1, Number(tocCfg.depth) || 2));

const styleBase = book.style ?? {};
const pdfBase = book.pdf ?? {};
const coverBase = book.cover ?? {};
const backBase = book.back_cover ?? {};

// 多主题：默认单主题（空 name = 使用标准文件名）
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
    // 主题名进入输出文件名，必须安全（check 也会校验，这里兜底）
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
const themes = normalizeThemes(book.themes);

// 非默认主题的产物：basename 加 .<name> 后缀（同目录，assets 共享）
function variantPath(basePath, theme) {
  if (theme.isDefault) return basePath;
  const ext = path.extname(basePath);
  return path.join(
    path.dirname(basePath),
    `${path.basename(basePath, ext)}.${theme.name}${ext}`
  );
}

/* ---------- 工具函数 ---------- */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

// 防止配置值破坏内联 <style>
const sanitizeCssValue = (v) => String(v).replace(/[{}<>;]/g, "").trim();

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

// CSS margin 简写 → 上右下左
function marginParts(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" };
  }
  const [a, b = a, c = a, d = b] = parts;
  return { top: a, right: b, bottom: c, left: d };
}

function slugifyHeading(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// 模板填充：单遍替换，插入的内容不会被二次扫描
function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key) =>
    Object.hasOwn(values, key) ? values[key] : whole
  );
}

const metaValues = {
  lang: escapeHtml(language),
  title: escapeHtml(title),
  subtitle: escapeHtml(subtitle),
  authors: escapeHtml(authorsText),
  date: escapeHtml(date)
};

/* ---------- 静态资源与模板（读取一次，各主题共用） ---------- */

const printCss = fs.readFileSync(path.join(templatesDir, "print.css"), "utf8");
const documentTemplate = fs.readFileSync(path.join(templatesDir, "document.html"), "utf8");
const indexTemplate = fs.readFileSync(path.join(templatesDir, "index.html"), "utf8");

let katexCssPath;
try {
  katexCssPath = require.resolve("katex/dist/katex.min.css");
} catch {
  katexCssPath = path.join(path.dirname(require.resolve("katex")), "katex.min.css");
}
// KaTeX 字体改为从 dist/assets/katex-fonts/ 加载
const katexCss = fs
  .readFileSync(katexCssPath, "utf8")
  .replaceAll("url(fonts/", "url(assets/katex-fonts/");

/* ---------- 默认封面 / 封底组件 ---------- */

const DEFAULT_COVER =
  '<h1 class="cover-title">{{title}}</h1>\n' +
  '<p class="cover-subtitle">{{subtitle}}</p>\n' +
  '<p class="cover-authors">{{authors}}</p>\n' +
  '<p class="cover-date">{{date}}</p>';

const DEFAULT_BACK_COVER =
  '<div class="back-cover-inner">\n' +
  '<p class="back-cover-title">{{title}}</p>\n' +
  '<p class="back-cover-meta">{{authors}}</p>\n' +
  '<p class="back-cover-meta">{{date}}</p>\n' +
  "</div>";

// 组件与 templates/ 同级别受信；占位符注入前已 HTML 转义
function loadComponent(file, label) {
  const componentPath = path.resolve(baseDir, String(file));
  if (!fs.existsSync(componentPath)) {
    console.error(`Error: ${label} component file not found: ${file}`);
    process.exit(1);
  }
  return renderTemplate(fs.readFileSync(componentPath, "utf8"), metaValues);
}

function resolveProjectOrToolFile(file) {
  const projectPath = path.resolve(baseDir, String(file));
  if (fs.existsSync(projectPath)) return projectPath;

  const toolPath = path.resolve(toolRoot, String(file));
  if (fs.existsSync(toolPath)) return toolPath;

  return projectPath;
}

/* ---------- 目录（各主题共用同一份配置） ---------- */

function buildToc(entries) {
  if (!tocEnabled) return "";
  const items = entries.filter((e) => e.level <= tocDepth);
  if (items.length === 0) return "";

  // .toc-page 是页码占位符：屏幕上隐藏；
  // render-pdf.mjs 第一遍打印后解析出真实页码，注入后再打印第二遍。
  const row = (entry) =>
    '<div class="toc-row">' +
    `<span class="toc-title"><a href="#${entry.id}">${escapeHtml(entry.title)}</a></span>` +
    '<span class="toc-leader"></span>' +
    `<span class="toc-page" data-target="${escapeHtml(entry.id)}"></span>` +
    "</div>";

  // 通用嵌套列表：层级跳跃（如 h1 → h3）按 +1 层处理，保证标签配平
  const minLevel = Math.min(...items.map((e) => e.level));
  let html = '<ol class="toc-list">\n';
  let prev = null;

  for (const entry of items) {
    const level =
      prev === null ? minLevel : Math.max(minLevel, Math.min(entry.level, prev + 1));

    if (prev === null) {
      html += `<li>${row(entry)}`;
    } else if (level > prev) {
      html += `\n<ol>\n<li>${row(entry)}`;
    } else {
      html += "</li>\n";
      for (let l = prev; l > level; l--) html += "</ol>\n</li>\n";
      html += `<li>${row(entry)}`;
    }
    prev = level;
  }

  html += "</li>\n";
  for (let l = prev; l > minLevel; l--) html += "</ol>\n</li>\n";
  html += "</ol>";

  return (
    '<nav class="toc">\n' +
    `<h2 class="toc-heading">${escapeHtml(tocTitle)}</h2>\n` +
    `${html}\n` +
    "</nav>"
  );
}

/* ---------- 单个主题的渲染 ---------- */

function buildTheme(theme) {
  // 主题配置浅合并覆盖基础配置（pdf 的嵌套键做二层合并）
  const styleCfg = { ...styleBase, ...theme.style };
  const pdfCfg = mergePdfCfg(pdfBase, theme.pdf);
  const coverCfg = { ...coverBase, ...theme.cover };
  const backCfg = { ...backBase, ...theme.back_cover };

  const coverEnabled = coverCfg.enabled ?? true;
  const backEnabled = backCfg.enabled ?? false;
  const withHeaderFooter = pdfCfg.header_footer ?? true;
  const coverHeaderFooter = pdfCfg.cover_header_footer ?? false;
  const pageNumberCfg = pdfCfg.page_numbers ?? {};
  const countCover = pageNumberCfg.count_cover ?? true;
  const coverUsesHeaderFooter = withHeaderFooter && coverHeaderFooter && countCover;

  const htmlOutTheme = variantPath(htmlOut, theme);
  const pdfOutTheme = variantPath(pdfOut, theme);
  const pdfHref = "./" + toPosix(path.basename(pdfOutTheme));

  /* ----- Markdown 渲染器（每主题独立实例，slug/脚注状态干净） ----- */

  // 跨章节全局唯一的 ID（中文标题同样可用）
  const usedSlugs = new Map();
  function uniqueSlug(headingTitle) {
    const base = slugifyHeading(headingTitle) || "section";
    const count = usedSlugs.get(base) ?? 0;
    usedSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }

  const tocEntries = [];

  const md = new MarkdownIt({
    html: false, // 禁止 Markdown 原始 HTML
    linkify: true,
    typographer: false,
    // 构建时语法高亮（highlight.js common 语言集，无运行时 JS）。
    // 语言未注册或失败时返回 "" 交回 markdown-it 默认转义。
    highlight: (source, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            `<pre><code class="hljs language-${escapeHtml(lang)}">` +
            hljs.highlight(source, { language: lang, ignoreIllegals: true }).value +
            "</code></pre>"
          );
        } catch {
          // 交回默认转义
        }
      }
      return "";
    }
  });

  md.use(markPlugin); // ==高亮== → <mark>
  md.use(footnotePlugin); // 脚注 [^1]
  md.use(katexPlugin, { throwOnError: false, errorColor: "#cc0000" }); // $...$ / $$...$$
  md.use(anchorPlugin, {
    slugify: uniqueSlug,
    callback: (token, info) => {
      tocEntries.push({
        level: Number(token.tag.slice(1)),
        id: info.slug,
        title: info.title
      });
    }
  });

  // 外部链接在新标签页打开
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noopener noreferrer");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // 图片路径重写：相对路径按章节文件所在目录解析，
  // 再改写为相对 dist/ 的路径（notes/assets → dist/assets）。
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";

    const isRemote = /^(https?:)?\/\//i.test(src) || /^(data|mailto):/i.test(src);
    if (src && !isRemote && !path.isAbsolute(src)) {
      let decoded = src;
      try {
        decoded = decodeURI(src);
      } catch {
        // 保留原样
      }
      const resolved = path.resolve(env.chapterDir ?? baseDir, decoded);
      const relFromNotes = path.relative(notesDir, resolved);

      if (!relFromNotes.startsWith("..") && !path.isAbsolute(relFromNotes)) {
        const rewritten = toPosix(relFromNotes);
        token.attrSet("src", encodeURI(rewritten));
        if (!rewritten.startsWith("assets/")) {
          console.warn(
            `Warning: image "${src}" is not under notes/assets/ and will not be copied to dist/.`
          );
        }
      } else {
        console.warn(
          `Warning: image "${src}" resolves outside notes/; keeping the original path ` +
            `(it may be broken in dist/).`
        );
      }
    }
    return defaultImage(tokens, idx, options, env, self);
  };

  // 图片尺寸（![alt|300x200]）+ 图注（独立成段的图片 + title → <figure>/<figcaption>）
  md.core.ruler.push("handout_figures", (state) => {
    const Token = state.Token;
    const tokens = state.tokens;

    // 1) 尺寸语法：alt 里最后一个 "|300" 或 "|300x200"
    for (const blockToken of tokens) {
      if (blockToken.type !== "inline" || !blockToken.children) continue;
      for (const child of blockToken.children) {
        if (child.type !== "image") continue;
        const match = (child.content ?? "").match(/^(.*)\|\s*(\d+)(?:\s*[xX×]\s*(\d+))?\s*$/s);
        if (!match) continue;

        const cleanAlt = match[1].trim();
        child.content = cleanAlt;
        const textToken = new Token("text", "", 0);
        textToken.content = cleanAlt;
        child.children = [textToken];

        // 用内联 style（数字来自正则，安全），height 未给时保持等比
        let style = `width: ${match[2]}px;`;
        if (match[3]) style += ` height: ${match[3]}px;`;
        child.attrSet("style", style);
      }
    }

    // 2) 隐式 figure：段落里只有一张图片时包成 <figure>，title 变 <figcaption>
    for (let i = 0; i + 2 < tokens.length; i++) {
      const open = tokens[i];
      const inline = tokens[i + 1];
      const close = tokens[i + 2];
      if (
        open.type !== "paragraph_open" ||
        inline.type !== "inline" ||
        close.type !== "paragraph_close"
      ) {
        continue;
      }
      const kids = (inline.children ?? []).filter(
        (t) => !(t.type === "text" && t.content.trim() === "")
      );
      if (kids.length !== 1 || kids[0].type !== "image") continue;

      const img = kids[0];
      open.type = "figure_open";
      open.tag = "figure";
      close.type = "figure_close";
      close.tag = "figure";
      inline.children = [img];

      const captionText = img.attrGet("title");
      if (captionText) {
        img.attrs = img.attrs.filter(([name]) => name !== "title");
        const capOpen = new Token("figcaption_open", "figcaption", 1);
        const capInline = new Token("inline", "", 0);
        capInline.content = captionText;
        const capText = new Token("text", "", 0);
        capText.content = captionText;
        capInline.children = [capText];
        const capClose = new Token("figcaption_close", "figcaption", -1);
        tokens.splice(i + 2, 0, capOpen, capInline, capClose);
        i += 3;
      }
    }
  });

  /* ----- 网页打印的运行页眉 ----- */
  // 浏览器 Ctrl+P 拿不到 Chromium 的 headerTemplate（那是打印管线专属），
  // 也没有 CSS @page 边距盒可用。这里用 <thead> 跨页重复的标准行为：
  // 每章（和目录）包一层单格表格，表头即运行页眉，浏览器打印时每页重复；
  // 官方 PDF 管线会加 html.mhb-pdf 隐藏它（官方页眉画在页边距区）。
  // 页码只在官方 PDF 中存在（浏览器无逐页计数能力），{{page}}/{{total}} 会被剔除。
  const runningHeaderHtml = (() => {
    if (!withHeaderFooter) return "";
    const displayDate = formatDate(rawDate, pdfCfg.date_format ?? dateFormat);
    const values = {
      title,
      subtitle,
      authors: authorsText,
      author: authors[0] ?? "",
      date: displayDate,
      rawDate,
      lang: language,
      theme: theme.label || theme.name || ""
    };
    const renderSlot = (t) =>
      String(t ?? "")
        .replace(/\{\{(\w+)\}\}/g, (whole, key) => {
          if (key === "page" || key === "total") return "";
          return Object.hasOwn(values, key) ? escapeHtml(values[key]) : whole;
        })
        .trim();
    const slots = { left: "{{title}}", center: "", right: "{{date}}", ...(pdfCfg.header ?? {}) };
    const left = renderSlot(slots.left);
    const center = renderSlot(slots.center);
    const right = renderSlot(slots.right);
    if (!left && !center && !right) return "";
    return (
      '<div class="hb-run" aria-hidden="true">' +
      `<span class="hb-run-slot hb-run-left">${left}</span>` +
      `<span class="hb-run-slot hb-run-center">${center}</span>` +
      `<span class="hb-run-slot hb-run-right">${right}</span>` +
      "</div>"
    );
  })();

  const wrapWithRunningHeader = (innerHtml) =>
    runningHeaderHtml
      ? '<table class="hb-sheet"><thead class="hb-running"><tr><td>' +
        runningHeaderHtml +
        "</td></tr></thead><tbody><tr><td>\n" +
        innerHtml +
        "\n</td></tr></tbody></table>"
      : innerHtml;

  /* ----- 渲染章节 ----- */

  const sections = [];
  book.chapters.forEach((chapter, i) => {
    const absPath = path.resolve(baseDir, String(chapter));
    let source;
    try {
      // 去掉 UTF-8 BOM：带 BOM 时首行的 "# 标题" 不会被识别为标题
      source = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
    } catch (err) {
      console.error(`Error: cannot read chapter file: ${chapter} (${err.message})`);
      console.error('Run "npm run check" for details.');
      process.exit(1);
    }

    // docId 用于给脚注 ID 加章节前缀，避免跨章节 ID 冲突
    const env = { docId: `ch${i + 1}`, chapterDir: path.dirname(absPath) };
    const bodyHtml = md.render(source, env);
    sections.push(
      `<section class="chapter" data-chapter="${i + 1}">\n${wrapWithRunningHeader(bodyHtml)}</section>`
    );
  });

  /* ----- CSS：变量覆盖 + @page + 自定义 CSS ----- */

  const varMap = {
    accent_color: "--hb-accent",
    content_width: "--hb-content-width",
    base_font_size: "--hb-base-font-size",
    print_font_size: "--hb-print-font-size"
  };
  const rootVars = Object.entries(varMap)
    .filter(([key]) => styleCfg[key])
    .map(([key, cssVar]) => `  ${cssVar}: ${sanitizeCssValue(styleCfg[key])};`);

  // 字体栈（style.fonts.body / heading / code）
  const fonts = styleCfg.fonts ?? {};
  if (fonts.body) rootVars.push(`  --hb-font-body: ${sanitizeCssValue(fonts.body)};`);
  if (fonts.heading) rootVars.push(`  --hb-font-heading: ${sanitizeCssValue(fonts.heading)};`);
  if (fonts.code) rootVars.push(`  --hb-font-code: ${sanitizeCssValue(fonts.code)};`);

  // 页眉页脚样式 → CSS 变量（网页打印的运行页眉与官方 PDF 保持一致外观）
  const hfStyleCfg = pdfCfg.header_footer_style ?? {};
  if (hfStyleCfg.font_size) rootVars.push(`  --hb-hf-font-size: ${sanitizeCssValue(hfStyleCfg.font_size)};`);
  if (hfStyleCfg.color) rootVars.push(`  --hb-hf-color: ${sanitizeCssValue(hfStyleCfg.color)};`);
  if (hfStyleCfg.font_family) rootVars.push(`  --hb-hf-font-family: ${sanitizeCssValue(hfStyleCfg.font_family)};`);

  // 封面 / 封底背景与文字色
  if (coverCfg.background) rootVars.push(`  --hb-cover-bg: ${sanitizeCssValue(coverCfg.background)};`);
  if (coverCfg.color) rootVars.push(`  --hb-cover-color: ${sanitizeCssValue(coverCfg.color)};`);
  if (backCfg.background) rootVars.push(`  --hb-back-bg: ${sanitizeCssValue(backCfg.background)};`);
  if (backCfg.color) rootVars.push(`  --hb-back-color: ${sanitizeCssValue(backCfg.color)};`);

  // pdf.margin 覆盖时，同步页边距镜像变量（封面/封底内容定位用）
  if (pdfCfg.margin) {
    const m = marginParts(sanitizeCssValue(pdfCfg.margin));
    rootVars.push(`  --hb-page-margin-top: ${m.top};`);
    rootVars.push(`  --hb-page-margin-right: ${m.right};`);
    rootVars.push(`  --hb-page-margin-bottom: ${m.bottom};`);
    rootVars.push(`  --hb-page-margin-left: ${m.left};`);
  }

  // 封面也要显示页眉页脚时：第一页恢复正常页边距，封面顶部留白相应减小
  if (coverUsesHeaderFooter) {
    rootVars.push("  --hb-cover-pad-top: 60mm;");
  }

  let overrideCss = "";
  if (rootVars.length > 0) {
    overrideCss += `:root {\n${rootVars.join("\n")}\n}\n`;
  }
  const pageRules = [];
  if (pdfCfg.page_size) pageRules.push(`size: ${sanitizeCssValue(pdfCfg.page_size)};`);
  if (pdfCfg.margin) pageRules.push(`margin: ${sanitizeCssValue(pdfCfg.margin)};`);
  if (pageRules.length > 0) {
    overrideCss += `@page {\n  ${pageRules.join("\n  ")}\n}\n`;
  }

  // 无封面 / 封面带页眉页脚时，第一页不再需要 margin:0 的全出血设定
  if (!coverEnabled || coverUsesHeaderFooter) {
    overrideCss += `@page :first {\n  margin: ${sanitizeCssValue(pdfCfg.margin ?? "18mm 16mm 20mm 16mm")};\n}\n`;
  }

  // 追加自定义 CSS（字符串或数组，最后加载，优先级最高）
  const customList = Array.isArray(styleCfg.custom_css)
    ? styleCfg.custom_css
    : styleCfg.custom_css
      ? [styleCfg.custom_css]
      : [];
  const customCss = customList
    .map((file) => {
      const customCssPath = resolveProjectOrToolFile(file);
      if (!fs.existsSync(customCssPath)) {
        console.error(`Error: style.custom_css file not found: ${file}`);
        process.exit(1);
      }
      return fs.readFileSync(customCssPath, "utf8");
    })
    .join("\n");

  const inlineCss =
    `/* ===== KaTeX ===== */\n${katexCss}\n/* ===== print.css ===== */\n${printCss}` +
    (overrideCss ? `\n/* ===== book.yml overrides ===== */\n${overrideCss}` : "") +
    (customCss ? `\n/* ===== custom css ===== */\n${customCss}` : "");

  /* ----- 封面 / 封底组件 ----- */

  const coverHtml = coverEnabled
    ? '<header id="cover" class="cover">\n' +
      (coverCfg.html
        ? loadComponent(coverCfg.html, "cover.html")
        : renderTemplate(DEFAULT_COVER, metaValues)) +
      "\n</header>"
    : "";

  const backCoverHtml = backEnabled
    ? '<footer id="back-cover" class="back-cover">\n' +
      (backCfg.html
        ? loadComponent(backCfg.html, "back_cover.html")
        : renderTemplate(DEFAULT_BACK_COVER, metaValues)) +
      "\n</footer>"
    : "";

  /* ----- 写出 HTML ----- */

  // 浏览器标签页标题：非默认主题附加主题名，便于区分
  const docTitle = theme.isDefault ? title : `${title} · ${theme.label || theme.name}`;

  // 目录页同样带运行页眉（封面/封底不带）
  const tocRaw = buildToc(tocEntries);
  const tocHtml = tocRaw
    ? tocRaw.replace(/^(<nav class="toc">\n)([\s\S]*)(\n<\/nav>)$/, (whole, open, inner, close) =>
        open + wrapWithRunningHeader(inner) + close
      )
    : "";

  const handoutHtml = renderTemplate(documentTemplate, {
    ...metaValues,
    docTitle: escapeHtml(docTitle),
    pdfHref: escapeHtml(pdfHref),
    cover: coverHtml,
    toc: tocHtml,
    backCover: backCoverHtml,
    css: inlineCss,
    body: sections.join("\n\n")
  });

  fs.mkdirSync(path.dirname(htmlOutTheme), { recursive: true });
  fs.writeFileSync(htmlOutTheme, handoutHtml);
  console.log(`Generated ${toPosix(path.relative(process.cwd(), htmlOutTheme))}`);

  return { theme, htmlOutTheme, pdfOutTheme, styleCfg, fonts, tocEntries };
}

/* ---------- 渲染所有主题 ---------- */

const built = themes.map((theme) => buildTheme(theme));
const defaultBuild = built.find((b) => b.theme.isDefault) ?? built[0];

/* ---------- 首页（一次，含各主题入口） ---------- */

const defaultHtmlHref = "./" + toPosix(path.basename(defaultBuild.htmlOutTheme));
const defaultPdfHref = "./" + toPosix(path.basename(defaultBuild.pdfOutTheme));

const variantsHtml = built
  .filter((b) => !b.theme.isDefault)
  .map(
    (b) =>
      `<span class="variant-label">${escapeHtml(b.theme.label || b.theme.name)}</span>` +
      `<a href="./${escapeHtml(path.basename(b.htmlOutTheme))}">HTML</a>` +
      '<span class="sep">&middot;</span>' +
      `<a href="./${escapeHtml(path.basename(b.pdfOutTheme))}" download>PDF</a>`
  )
  .join("\n");

// 章节序号：≤12 用罗马数字（最宽 XII，不破坏对齐），更多则用补零十进制
function romanNumeral(n) {
  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let out = "";
  for (const [value, symbol] of map) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

// 首页章节导航：默认主题的一级标题，链接到 handout 内锚点
const chapterItems = (defaultBuild.tocEntries ?? []).filter((e) => e.level === 1);
const useRoman = chapterItems.length <= 12;
const pad = String(chapterItems.length).length;
const chapterNo = (i) =>
  useRoman ? romanNumeral(i + 1) : String(i + 1).padStart(Math.max(2, pad), "0");
const chaptersHtml =
  chapterItems.length > 0
    ? '<p class="sec-label">CONTENTS</p>\n<div class="chapters">\n' +
      chapterItems
        .map(
          (e, i) =>
            '<div class="ch">' +
            `<span class="no">${chapterNo(i)}</span>` +
            `<a href="${escapeHtml(defaultHtmlHref)}#${escapeHtml(e.id)}">${escapeHtml(e.title)}</a>` +
            "</div>"
        )
        .join("\n") +
      "\n</div>"
    : "";
const chapterCount = chapterItems.length || book.chapters.length;

const defaultFonts = defaultBuild.fonts ?? {};
const indexFontVars = defaultFonts.body
  ? ` --hb-font-body: ${sanitizeCssValue(defaultFonts.body)};`
  : "";

const indexHtml = renderTemplate(indexTemplate, {
  ...metaValues,
  htmlHref: escapeHtml(defaultHtmlHref),
  pdfHref: escapeHtml(defaultPdfHref),
  accent: escapeHtml(sanitizeCssValue(defaultBuild.styleCfg.accent_color ?? "#1f6feb")),
  fontVars: indexFontVars,
  chapters: chaptersHtml,
  chapterCount: escapeHtml(String(chapterCount)),
  variants: variantsHtml
    ? '<div class="variants"><span class="lb">Other themes:</span>\n' + variantsHtml + "\n</div>"
    : ""
});

const indexOut = path.join(distDir, "index.html");
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(indexOut, indexHtml);

/* ---------- 复制静态资源（一次） ---------- */

const notesAssets = path.join(notesDir, "assets");
if (fs.existsSync(notesAssets)) {
  fs.cpSync(notesAssets, path.join(distDir, "assets"), { recursive: true });
}

const katexFontsDir = path.join(path.dirname(katexCssPath), "fonts");
if (fs.existsSync(katexFontsDir)) {
  fs.cpSync(katexFontsDir, path.join(distDir, "assets", "katex-fonts"), {
    recursive: true
  });
}

const thirdPartyNotices = path.join(toolRoot, "THIRD_PARTY_NOTICES.md");
if (fs.existsSync(thirdPartyNotices)) {
  fs.copyFileSync(thirdPartyNotices, path.join(distDir, "THIRD_PARTY_NOTICES.md"));
}

console.log(`Generated ${toPosix(path.relative(process.cwd(), indexOut))}`);
