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

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import markdownItAnchorModule from "markdown-it-anchor";
import markdownItContainerModule from "markdown-it-container";
import markdownItFootnoteModule from "markdown-it-footnote";
import markdownItMarkModule from "markdown-it-mark";
import markdownItKatexModule from "@vscode/markdown-it-katex";
import YAML from "yaml";

import { normalizeChapters, isValidClassAttr } from "./lib/chapters.mjs";
import { createObsidianDialect, createObsidianVault } from "./lib/obsidian.mjs";

const require = createRequire(import.meta.url);

// 兼容 CJS/ESM 双格式导出
const interop = (mod) =>
  mod && typeof mod === "object" && "default" in mod ? mod.default : mod;

const anchorPlugin = interop(markdownItAnchorModule);
const containerPlugin = interop(markdownItContainerModule);
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

if (!book || typeof book !== "object") {
  console.error(`Error: ${path.basename(configPath)} is empty or not a YAML mapping.`);
  process.exit(1);
}

// chapters: inline list or an external chapters file; each entry is a file path
// whose extension decides its role (.md -> chapter, .html -> raw insert page).
const chaptersResult = normalizeChapters(book, baseDir);
if (chaptersResult.error) {
  console.error(`Error: ${chaptersResult.error}`);
  console.error('Run "npm run check" for details.');
  process.exit(1);
}
const chapterEntries = chaptersResult.entries;

/* ---------- Markdown 方言（默认保持现有严格模式） ---------- */

if (book.markdown !== undefined && (!book.markdown || typeof book.markdown !== "object" || Array.isArray(book.markdown))) {
  console.error('Error: "markdown" must be a mapping.');
  process.exit(1);
}
const markdownCfg = book.markdown ?? {};
const markdownDialect = String(markdownCfg.dialect ?? "standard").toLowerCase();
const obsidianEnabled = markdownDialect === "obsidian";
const obsidianCfg = markdownCfg.obsidian ?? {};
if (obsidianEnabled && (!obsidianCfg || typeof obsidianCfg !== "object" || Array.isArray(obsidianCfg))) {
  console.error('Error: "markdown.obsidian" must be a mapping.');
  process.exit(1);
}
if (obsidianEnabled && obsidianCfg.vault_root !== undefined && typeof obsidianCfg.vault_root !== "string") {
  console.error("Error: markdown.obsidian.vault_root must be a directory path string.");
  process.exit(1);
}
const obsidianVaultRoot = path.resolve(baseDir, String(obsidianCfg.vault_root ?? "."));
const obsidianPropertiesMode = String(obsidianCfg.properties ?? "visible").toLowerCase();
if (!["standard", "obsidian"].includes(markdownDialect)) {
  console.error(`Error: unsupported markdown.dialect ${JSON.stringify(markdownDialect)}.`);
  process.exit(1);
}
if (obsidianEnabled && (!fs.existsSync(obsidianVaultRoot) || !fs.statSync(obsidianVaultRoot).isDirectory())) {
  console.error(`Error: markdown.obsidian.vault_root is not a directory: ${obsidianVaultRoot}`);
  process.exit(1);
}
if (obsidianEnabled && !["visible", "hidden", "source"].includes(obsidianPropertiesMode)) {
  console.error('Error: markdown.obsidian.properties must be "visible", "hidden", or "source".');
  process.exit(1);
}
const obsidianVault = obsidianEnabled ? createObsidianVault(obsidianVaultRoot) : null;

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
// 讲义自身的修订版次（如 "v2"、"第 3 版"、"Rev. B"），可选
const bookVersion =
  book.version !== undefined && book.version !== null ? String(book.version) : "";

// 构建溯源元数据：{{commit}} = 笔记仓库的短 hash（非 git 目录时为空串）。
// 有未提交改动时加 -dirty 后缀，避免产物标注一个不含当前内容的 hash。
// 注意 cwd 是 baseDir（笔记仓库），不是本工具的仓库。
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

const htmlOut = path.resolve(baseDir, book.output?.html ?? "dist/handout.html");
const pdfOut = path.resolve(baseDir, book.output?.pdf ?? "dist/handout.pdf");
const distDir = path.dirname(htmlOut);
const notesDir = path.join(baseDir, "notes");

/* ---------- 可选配置：目录 / 样式 / PDF / 封面封底 / 主题 ---------- */

const tocCfg = book.toc ?? {};
const tocEnabled = tocCfg.enabled ?? true;
const tocTitle = tocCfg.title ? String(tocCfg.title) : "目录";
const tocDepth = Math.min(3, Math.max(1, Number(tocCfg.depth) || 2));

// Per-chapter mini table of contents ("In this chapter"). Off by default; a
// chapter opts in with `chapter_toc: true`, or set chapter_toc.default: true to
// turn it on for every chapter. Rendered as an isolated <nav class="chapter-toc">
// that reuses the .toc-page[data-target] hook, so the PDF page-number pass fills
// it with real page numbers for free.
const chapterTocCfg = book.chapter_toc ?? {};
const chapterTocDefault = chapterTocCfg.default ?? false;
const chapterTocTitle =
  chapterTocCfg.title !== undefined && chapterTocCfg.title !== null
    ? String(chapterTocCfg.title)
    : "In this chapter";
const chapterTocDepth = Math.min(6, Math.max(2, Number(chapterTocCfg.depth) || 3));
const chapterTocClass =
  chapterTocCfg.class && isValidClassAttr(chapterTocCfg.class)
    ? String(chapterTocCfg.class).trim()
    : "";

/* ---------- 标签与自定义容器 ---------- */

// 设计原则：工具不生成任何内容编号——编号属于内容，由作者直接写在
// 标题、环境名称、图注或公式 \tag 里，Markdown 所见即所得。
//
// 内置标签只有英文默认值——不内置任何其他语言包，任何语言的显示文本
// 都通过 book.yml 的 labels 逐项定义。labels 里的"新键"会注册为自定义
// 容器（::: key）：提示（tip）样式的告示块，渲染时附加
// admonition-custom admonition-<key> class 供 custom CSS 定制。
const DEFAULT_LABELS = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  danger: "Danger",
  theorem: "Theorem",
  definition: "Definition",
  example: "Example",
  exercise: "Exercise"
};
const BUILTIN_ADMONITIONS = ["note", "tip", "warning", "danger"];
const BUILTIN_ENVS = ["theorem", "definition", "example", "exercise"];
const RESERVED_CONTAINER_KEYS = new Set([
  ...BUILTIN_ADMONITIONS,
  ...BUILTIN_ENVS,
  "pagebreak"
]);

const labels = { ...DEFAULT_LABELS };
const customContainers = [];
for (const [key, raw] of Object.entries(book.labels ?? {})) {
  const text = raw === undefined || raw === null ? "" : String(raw);

  if (RESERVED_CONTAINER_KEYS.has(key)) {
    if (text) labels[key] = text;
    continue;
  }
  // 新键作为容器名与 CSS class，必须是安全的 ASCII 标识符（check 会报错，此处兜底）
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) continue;
  customContainers.push({ key, text: text || key });
}

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
  date: escapeHtml(date),
  version: escapeHtml(bookVersion),
  commit: escapeHtml(gitCommit)
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
  '<p class="cover-date">{{date}}</p>' +
  (bookVersion ? '\n<p class="cover-version">{{version}}</p>' : "");

const DEFAULT_BACK_COVER =
  '<div class="back-cover-inner">\n' +
  '<p class="back-cover-title">{{title}}</p>\n' +
  '<p class="back-cover-meta">{{authors}}</p>\n' +
  '<p class="back-cover-meta">{{date}}</p>\n' +
  (bookVersion ? '<p class="back-cover-meta">{{version}}</p>\n' : "") +
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
    '<nav class="toc" id="toc">\n' +
    `<h2 class="toc-heading">${escapeHtml(tocTitle)}</h2>\n` +
    `${html}\n` +
    "</nav>"
  );
}

// Per-chapter mini TOC. Lists this chapter's sub-headings (levels 2..depth; the
// chapter's own h1 is the title, not a row). Uses distinct .chapter-toc* classes
// (isolated from the main .toc) but keeps the .toc-page[data-target] hook so the
// render-pdf page-number pass fills it. Chapter TOCs live in the body flow and
// are always counted toward page numbers.
function buildChapterToc(headings) {
  const items = headings.filter((e) => e.level >= 2 && e.level <= chapterTocDepth);
  if (items.length === 0) return "";

  const minLevel = Math.min(...items.map((e) => e.level));
  const rows = items
    .map((e) => {
      const indent = Math.max(0, e.level - minLevel);
      const indentClass = indent > 0 ? ` chapter-toc-l${indent}` : "";
      return (
        `<li class="chapter-toc-row${indentClass}">` +
        `<span class="chapter-toc-title"><a href="#${escapeHtml(e.id)}">${escapeHtml(e.title)}</a></span>` +
        '<span class="chapter-toc-leader"></span>' +
        `<span class="toc-page" data-target="${escapeHtml(e.id)}"></span>` +
        "</li>"
      );
    })
    .join("\n");

  const cls = ["chapter-toc", chapterTocClass].filter(Boolean).join(" ");
  const heading = chapterTocTitle
    ? `<p class="chapter-toc-heading">${escapeHtml(chapterTocTitle)}</p>\n`
    : "";
  return `<nav class="${cls}">\n${heading}<ul class="chapter-toc-list">\n${rows}\n</ul>\n</nav>`;
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

  const obsidian = obsidianEnabled
    ? createObsidianDialect({
        baseDir,
        vaultRoot: obsidianVaultRoot,
        vaultIndex: obsidianVault,
        propertiesMode: obsidianPropertiesMode,
        escapeHtml,
        slugify: slugifyHeading
      })
    : null;

  const md = new MarkdownIt({
    // Obsidian Flavored Markdown follows CommonMark and permits raw HTML.
    // The dialect is opt-in because chapter Markdown is trusted content in this mode.
    html: obsidianEnabled,
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

  // 告示块：内置四类 + labels 定义的自定义容器（默认提示样式）
  const admonitionDefs = [
    ...BUILTIN_ADMONITIONS.map((key) => ({ key, extraClass: "" })),
    ...customContainers.map((c) => ({
      key: c.key,
      extraClass: " admonition-custom",
      text: c.text
    }))
  ];
  for (const def of admonitionDefs) {
    md.use(containerPlugin, def.key, {
      render(tokens, idx) {
        const token = tokens[idx];
        if (token.nesting === 1) {
          const custom = token.info.trim().slice(def.key.length).trim();
          const label = custom || def.text || labels[def.key] || def.key;
          return (
            `<div class="admonition${def.extraClass} admonition-${def.key}">\n` +
            `<p class="admonition-title">${escapeHtml(label)}</p>\n`
          );
        }
        return "</div>\n";
      }
    });
  }

  // 学术环境：::: theorem|definition|example|exercise [名称]。
  // 不做任何自动编号——需要编号时作者直接写进名称，
  // 例如 "::: theorem 3.1 柯西不等式" 渲染为 "Theorem 3.1 柯西不等式"。
  for (const envType of BUILTIN_ENVS) {
    md.use(containerPlugin, envType, {
      render(tokens, idx) {
        const token = tokens[idx];
        if (token.nesting === 1) {
          const name = token.info.trim().slice(envType.length).trim();
          const labelText = labels[envType] || envType;
          const nameHtml = name
            ? ` <span class="env-name">${escapeHtml(name)}</span>`
            : "";
          return (
            `<div class="env env-${envType}">\n` +
            `<p class="env-title"><span class="env-label">${escapeHtml(labelText)}</span>${nameHtml}</p>\n`
          );
        }
        return "</div>\n";
      }
    });
  }

  md.use(katexPlugin, { throwOnError: false, errorColor: "#cc0000" }); // $...$ / $$...$$（公式编号请用 KaTeX 原生 \tag{...}）
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
  if (obsidian) obsidian.install(md);

  // 外部链接在新标签页打开
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    let href = tokens[idx].attrGet("href") ?? "";
    const rewritten = obsidian?.rewriteMarkdownLink(href, env);
    if (rewritten) {
      tokens[idx].attrSet("href", rewritten);
      tokens[idx].attrJoin("class", "internal-link");
      href = rewritten;
    }
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

    const obsidianSrc = obsidian?.rewriteMarkdownImage(src, env);
    if (obsidianSrc) {
      token.attrSet("src", obsidianSrc);
      return defaultImage(tokens, idx, options, env, self);
    }

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
  // + 手动分页符：独行的 \pagebreak 或 \newpage
  md.core.ruler.push("handout_figures", (state) => {
    const Token = state.Token;
    const tokens = state.tokens;

    // 0) 分页符：段落内容只有 \pagebreak / \newpage 时替换为分页 div
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (
        tokens[i].type === "paragraph_open" &&
        tokens[i + 1].type === "inline" &&
        tokens[i + 2].type === "paragraph_close" &&
        /^\\(pagebreak|newpage)$/.test(tokens[i + 1].content.trim())
      ) {
        const marker = new Token("html_block", "", 0);
        marker.content = '<div class="hb-pagebreak" aria-hidden="true"></div>\n';
        tokens.splice(i, 3, marker);
      }
    }

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
      version: bookVersion,
      commit: gitCommit,
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
  let leadAssigned = false;
  const leadClass = () => {
    if (leadAssigned) return "";
    leadAssigned = true;
    return " hb-lead"; // first body section: no forced page break before it
  };

  function renderObsidianSource(source, env, { transcluded = false } = {}) {
    const prepared = obsidian.prepareSource(source);
    if (prepared.frontmatterError) {
      const rel = toPosix(path.relative(baseDir, env.obsidianFile));
      console.error(`Error: invalid Obsidian properties in ${rel}: ${prepared.frontmatterError}`);
      process.exit(1);
    }

    let html = md.render(prepared.source, env);
    html = obsidian.expandNoteEmbeds(html, (embed, embeddedSource) => {
      const stack = env.obsidianStack ?? [env.obsidianFile];
      const label = embed.file.relPath + (embed.spec.fragment ? `#${embed.spec.fragment}` : "");
      if (stack.includes(embed.file.absPath)) {
        const cycle = [...stack, embed.file.absPath]
          .map((file) => toPosix(path.relative(obsidianVaultRoot, file)))
          .join(" -> ");
        obsidian.warnings.add(`Cyclic Obsidian note embed skipped: ${cycle}`);
        const errorHtml =
          `<span class="obsidian-note-embed unresolved">Cyclic embed: ${escapeHtml(label)}</span>`;
        return {
          blockHtml: `<div class="obsidian-note-embed unresolved">${errorHtml}</div>`,
          inlineHtml: errorHtml
        };
      }

      const tocStart = tocEntries.length;
      const child = renderObsidianSource(
        embeddedSource,
        {
          docId: `${env.docId}-embed${embed.id + 1}`,
          chapterDir: path.dirname(embed.file.absPath),
          obsidianFile: embed.file.absPath,
          obsidianTransclusion: true,
          obsidianStack: [...stack, embed.file.absPath]
        },
        { transcluded: true }
      );
      // Embedded headings render and remain linkable, but do not enter the
      // handout's own TOC/outline.
      tocEntries.splice(tocStart);
      return {
        blockHtml:
          `<div class="obsidian-note-embed" data-source="${escapeHtml(label)}">\n` +
          `${child.html}\n</div>`,
        inlineHtml:
          `<span class="obsidian-note-embed-inline" data-source="${escapeHtml(label)}">` +
          `${escapeHtml(label)}</span>`
      };
    });

    if (!transcluded) {
      html = obsidian.renderProperties(prepared.properties, prepared.propertiesRaw, md, env) + html;
    }
    return { html, prepared };
  }

  chapterEntries.forEach((entry, i) => {
    const absPath = path.resolve(baseDir, entry.file);

    if (entry.kind === "insert") {
      // Trusted raw-HTML page. Placeholders ({{title}} ...) are filled; the
      // fragment's inner markup is authored as-is.
      let fragment;
      try {
        fragment = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
      } catch (err) {
        console.error(`Error: cannot read insert file: ${entry.file} (${err.message})`);
        console.error('Run "npm run check" for details.');
        process.exit(1);
      }
      const rendered = renderTemplate(fragment, metaValues);
      const cls = ["insert", entry.className].filter(Boolean).join(" ");
      sections.push(
        `<section class="${cls}${leadClass()}" data-entry="${i + 1}">\n` +
          wrapWithRunningHeader(rendered) +
          "\n</section>"
      );
      return;
    }

    // Markdown chapter
    let source;
    try {
      // 去掉 UTF-8 BOM：带 BOM 时首行的 "# 标题" 不会被识别为标题
      source = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
    } catch (err) {
      console.error(`Error: cannot read chapter file: ${entry.file} (${err.message})`);
      console.error('Run "npm run check" for details.');
      process.exit(1);
    }

    // docId 用于给脚注 ID 加章节前缀，避免跨章节 ID 冲突
    const env = {
      docId: `ch${i + 1}`,
      chapterDir: path.dirname(absPath),
      ...(obsidian
        ? { obsidianFile: absPath, obsidianStack: [absPath], obsidianTransclusion: false }
        : {})
    };
    const headingStart = tocEntries.length;
    const dialectRender = obsidian ? renderObsidianSource(source, env) : null;
    let bodyHtml = dialectRender?.html ?? md.render(source, env);

    // Optional per-chapter mini TOC, inserted right after the chapter's h1.
    const wantChapterToc = entry.chapterToc === null ? chapterTocDefault : entry.chapterToc;
    if (wantChapterToc) {
      const miniToc = buildChapterToc(tocEntries.slice(headingStart));
      if (miniToc) {
        bodyHtml = /<\/h1>/.test(bodyHtml)
          ? bodyHtml.replace("</h1>", `</h1>\n${miniToc}`)
          : miniToc + bodyHtml;
      }
    }

    const cls = ["chapter", entry.className, ...(dialectRender?.prepared.cssClasses ?? [])]
      .filter(Boolean)
      .join(" ");
    sections.push(
      `<section class="${cls}${leadClass()}" data-chapter="${i + 1}">\n${wrapWithRunningHeader(bodyHtml)}</section>`
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
    ? tocRaw.replace(
        /^(<nav class="toc" id="toc">\n)([\s\S]*)(\n<\/nav>)$/,
        (whole, open, inner, close) => open + wrapWithRunningHeader(inner) + close
      )
    : "";

  const bodyHtml = obsidian
    ? obsidian.finalizeLinks(sections.join("\n\n"))
    : sections.join("\n\n");
  const dialectScripts = obsidian?.usesMermaid
    ? '<script src="./assets/mermaid.min.js"></script>\n' +
      '<script>\n' +
      '  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });\n' +
      '  window.__MHB_RENDER_READY__ = mermaid.run({ querySelector: ".mermaid" });\n' +
      '</script>'
    : "";

  const handoutHtml = renderTemplate(documentTemplate, {
    ...metaValues,
    docTitle: escapeHtml(docTitle),
    pdfHref: escapeHtml(pdfHref),
    cover: coverHtml,
    toc: tocHtml,
    backCover: backCoverHtml,
    css: inlineCss,
    body: bodyHtml,
    scripts: dialectScripts
  });

  fs.mkdirSync(path.dirname(htmlOutTheme), { recursive: true });
  fs.writeFileSync(htmlOutTheme, handoutHtml);
  console.log(`Generated ${toPosix(path.relative(process.cwd(), htmlOutTheme))}`);

  return { theme, htmlOutTheme, pdfOutTheme, styleCfg, fonts, tocEntries, obsidian };
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
const chapterCount = chapterItems.length || chapterEntries.length;

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
  versionChip: bookVersion ? `<span>${escapeHtml(bookVersion)}</span>` : "",
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

if (defaultBuild.obsidian) {
  defaultBuild.obsidian.copyReferencedFiles(distDir);
  for (const warning of defaultBuild.obsidian.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

if (built.some((item) => item.obsidian?.usesMermaid)) {
  const mermaidPath = require.resolve("mermaid/dist/mermaid.min.js");
  const mermaidLicensePath = path.join(path.dirname(require.resolve("mermaid/package.json")), "LICENSE");
  fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
  fs.copyFileSync(mermaidPath, path.join(distDir, "assets", "mermaid.min.js"));
  if (fs.existsSync(mermaidLicensePath)) {
    fs.copyFileSync(mermaidLicensePath, path.join(distDir, "assets", "mermaid.LICENSE"));
  }
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
