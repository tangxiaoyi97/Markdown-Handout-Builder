#!/usr/bin/env node
/**
 * scripts/build.mjs
 *
 * 按 book.yml 的 structure/chapters 文档流渲染 Markdown，生成：
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
import markdownItContainerModule from "markdown-it-container";
import markdownItFootnoteModule from "markdown-it-footnote";
import markdownItMarkModule from "markdown-it-mark";
import markdownItKatexModule from "@vscode/markdown-it-katex";

import { normalizeChapters, isValidClassAttr } from "./lib/chapters.mjs";
import {
  toPosix,
  escapeHtml,
  formatDate,
  sanitizeCssValue,
  renderTemplate,
  slugifyHeading,
  resolveGitCommit
} from "./lib/util.mjs";
import {
  resolveConfigPath,
  loadBook,
  normalizeThemes,
  variantPath,
  mergePdfCfg
} from "./lib/config.mjs";
import {
  resolveDialectConfig,
  createDialectVault,
  instantiateDialect,
  dialectClientScripts,
  copyDialectRuntimeAssets
} from "./lib/dialects.mjs";
import { buildToc, buildChapterToc } from "./lib/toc.mjs";
import { buildCoverHtml, buildBackCoverHtml } from "./lib/covers.mjs";
import { buildOverrideCss, assembleInlineCss } from "./lib/css.mjs";
import {
  CONTENTS_SLOT_MARKER,
  dividerSectionHtml,
  blankSectionHtml,
  chapterMetaHtml,
  chapterCoverHtml
} from "./lib/special-pages.mjs";
import {
  parseFrontmatter,
  frontmatterContext,
  resolveFmPlaceholders
} from "./lib/frontmatter.mjs";

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

/* ---------- 读取配置 ---------- */

const configPath = resolveConfigPath();
const baseDir = path.dirname(configPath);
const book = loadBook(configPath);

// structure/chapters: normalize legacy paths, explicit types, layouts, parts,
// and includes into one flat renderer sequence.
const chaptersResult = normalizeChapters(book, baseDir);
if (chaptersResult.error) {
  console.error(`Error: ${chaptersResult.error}`);
  console.error('Run "npm run check" for details.');
  process.exit(1);
}
const chapterEntries = chaptersResult.entries;

/* ---------- Markdown 方言（默认保持现有严格模式） ---------- */

// 归一化与校验和 check.mjs 共用 lib/dialects.mjs；build 打印全部错误后退出
const dialectCfg = resolveDialectConfig(book, baseDir);
if (dialectCfg.errors.length > 0) {
  for (const message of dialectCfg.errors) console.error(`Error: ${message}`);
  console.error('Run "npm run check" for details.');
  process.exit(1);
}
const dialectVault = createDialectVault(dialectCfg);

/* ---------- Frontmatter 集成（v3，方言无关） ---------- */

const fmCfg = book.frontmatter ?? {};
const fmTitleAsHeading = fmCfg.title_as_heading === true;
const fmGlobalMeta = Array.isArray(fmCfg.meta) ? fmCfg.meta : false;
const fmLabels = { created: "Created", modified: "Updated", ...(fmCfg.labels ?? {}) };
const fmDatesFallback = String(fmCfg.dates?.fallback_modified ?? "none");

// {{fm.*}} 缺键告警去重（每文件每键一次）
const warnedFmMessages = new Set();
function fmWarn(file) {
  return (message) => {
    const dedupeKey = `${file}: ${message}`;
    if (warnedFmMessages.has(dedupeKey)) return;
    warnedFmMessages.add(dedupeKey);
    console.warn(`Warning: ${file}: ${message}`);
  };
}

// running 槽位里的 {{fm.*}} 在构建期按本章 frontmatter 解析；
// 其余占位符（{{page}} 等）留给官方 PDF 管线。
function resolveRunningFm(running, values, warn) {
  const band = (value) =>
    value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([slot, template]) => [
            slot,
            resolveFmPlaceholders(template, values, { warn })
          ])
        )
      : value;
  return { ...running, header: band(running.header), footer: band(running.footer) };
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
// 讲义自身的修订版次（如 "v2"、"第 3 版"、"Rev. B"），可选
const bookVersion =
  book.version !== undefined && book.version !== null ? String(book.version) : "";

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

const themes = normalizeThemes(book.themes);

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

  // 每主题独立的方言实例（slug / 引用状态隔离），vault 索引共享
  const dialect = instantiateDialect(dialectCfg, {
    baseDir,
    vaultIndex: dialectVault,
    escapeHtml,
    slugify: slugifyHeading
  });

  const md = new MarkdownIt({
    // 是否放行 Raw HTML 由方言决定（Obsidian 模式下章节内容受信）
    html: dialectCfg.allowRawHtml,
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
  if (dialect) dialect.install(md);

  // 外部链接在新标签页打开
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    let href = tokens[idx].attrGet("href") ?? "";
    const rewritten = dialect?.rewriteMarkdownLink(href, env);
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

    const dialectSrc = dialect?.rewriteMarkdownImage(src, env);
    if (dialectSrc) {
      token.attrSet("src", dialectSrc);
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

  function renderDialectSource(source, env, { transcluded = false } = {}) {
    const prepared = dialect.prepareSource(source);
    if (prepared.frontmatterError) {
      // Degrade instead of aborting the whole build: the note renders without
      // its properties block. "mhb check" reports the same problem as an error.
      const rel = toPosix(path.relative(baseDir, env.obsidianFile));
      dialect.warnings.add(
        `Invalid Obsidian properties in ${rel} (${prepared.frontmatterError}); ` +
          "rendering the note without them"
      );
    }

    let html = md.render(prepared.source, env);
    html = dialect.expandNoteEmbeds(html, (embed, embeddedSource) => {
      const stack = env.obsidianStack ?? [env.obsidianFile];
      const label = embed.file.relPath + (embed.spec.fragment ? `#${embed.spec.fragment}` : "");
      if (stack.includes(embed.file.absPath)) {
        const cycle = [...stack, embed.file.absPath]
          .map((file) => toPosix(path.relative(dialectCfg.vaultRoot, file)))
          .join(" -> ");
        dialect.warnings.add(`Cyclic Obsidian note embed skipped: ${cycle}`);
        const errorHtml =
          `<span class="obsidian-note-embed unresolved">Cyclic embed: ${escapeHtml(label)}</span>`;
        return {
          blockHtml: `<div class="obsidian-note-embed unresolved">${errorHtml}</div>`,
          inlineHtml: errorHtml
        };
      }

      const tocStart = tocEntries.length;
      const child = renderDialectSource(
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
      // role="paragraph" demotes transcluded headings in the accessibility
      // tree so Chromium's PDF outline (bookmarks) lists only the chapters'
      // own headings. Styling and anchor ids are unaffected.
      const demotedHtml = child.html.replace(
        /<h([1-6])\b(?![^>]*\brole=)/g,
        '<h$1 role="paragraph"'
      );
      return {
        blockHtml:
          `<div class="obsidian-note-embed" data-source="${escapeHtml(label)}">\n` +
          `${demotedHtml}\n</div>`,
        inlineHtml:
          `<span class="obsidian-note-embed-inline" data-source="${escapeHtml(label)}">` +
          `${escapeHtml(label)}</span>`
      };
    });

    if (!transcluded) {
      html = dialect.renderProperties(prepared.properties, prepared.propertiesRaw, md, env) + html;
    }
    return { html, prepared };
  }

  let dividerSeq = 0;
  let coverSeq = 0;
  let hasInFlowContents = false;
  const hasPerEntryRunningPolicy = chapterEntries.some(
    (entry) => entry.running?.custom
  );

  function entryFlowClasses(entry) {
    const before = entry.flow?.breakBefore ?? "page";
    const after = entry.flow?.breakAfter ?? "auto";
    return [
      before === "auto" ? "hb-break-before-auto" : "",
      after === "page" ? "hb-break-after-page" : ""
    ].filter(Boolean);
  }

  function entryDataAttributes(entry, anchorId = "") {
    const attrs = [];
    if (entry.layout) attrs.push(`data-layout="${escapeHtml(entry.layout)}"`);
    if (anchorId && hasPerEntryRunningPolicy) {
      attrs.push(`data-hb-anchor="${escapeHtml(anchorId)}"`);
    }
    if (entry.running?.header === false) attrs.push('data-hb-running-header="false"');
    if (entry.running?.footer === false) attrs.push('data-hb-running-footer="false"');
    if (entry.running?.custom) {
      const profile = JSON.stringify({
        header: entry.running.header,
        footer: entry.running.footer,
        style: entry.running.style ?? {},
        headerSet: Boolean(entry.running.headerSet),
        footerSet: Boolean(entry.running.footerSet),
        styleSet: Boolean(entry.running.styleSet)
      });
      attrs.push(`data-hb-running="${escapeHtml(profile)}"`);
    }
    return attrs.length ? ` ${attrs.join(" ")}` : "";
  }

  chapterEntries.forEach((entry, i) => {
    if (entry.kind === "divider") {
      dividerSeq += 1;
      const headingId = `hb-divider-${dividerSeq}`;
      // 把生成的 id 记入 slug 记账，避免正文标题撞车
      usedSlugs.set(headingId, (usedSlugs.get(headingId) ?? 0) + 1);
      sections.push(
        dividerSectionHtml(
          {
            ...entry,
            anchorId: hasPerEntryRunningPolicy ? headingId : "",
            className: [entry.className, ...entryFlowClasses(entry)].filter(Boolean).join(" ")
          },
          { headingId, lead: leadClass() }
        )
      );
      // toc 文案 → 主目录一条 level-1 行；页码由 h1 的 outline 映射回填
      if (entry.toc) {
        tocEntries.push({
          level: entry.navigation?.level ?? 1,
          id: headingId,
          title: entry.toc
        });
      }
      return;
    }

    if (entry.kind === "blank") {
      const blankEntry = {
        ...entry,
        className: [entry.className, ...entryFlowClasses(entry)].filter(Boolean).join(" ")
      };
      for (let n = 0; n < entry.count; n += 1) sections.push(blankSectionHtml(blankEntry));
      return;
    }

    if (entry.kind === "contents") {
      // 主目录在此布点；目录内容在全部条目渲染完成后回填
      hasInFlowContents = true;
      sections.push(CONTENTS_SLOT_MARKER);
      return;
    }

    const absPath = path.resolve(baseDir, entry.file);

    if (entry.format === "html") {
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
      const cls = ["insert", entry.className, ...entryFlowClasses(entry)].filter(Boolean).join(" ");
      sections.push(
        `<section class="${cls}${leadClass()}" data-entry="${i + 1}"${entryDataAttributes(entry)}>\n` +
          wrapWithRunningHeader(rendered) +
          "\n</section>"
      );
      return;
    }

    // Markdown：正常章节，或 as: insert 的 Markdown 特殊页（前言/致谢等）
    const isInsert = entry.kind === "insert";
    let source;
    try {
      // 去掉 UTF-8 BOM：带 BOM 时首行的 "# 标题" 不会被识别为标题
      source = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
    } catch (err) {
      console.error(`Error: cannot read chapter file: ${entry.file} (${err.message})`);
      console.error('Run "npm run check" for details.');
      process.exit(1);
    }

    // v3：frontmatter 上下文（方言无关）。标准方言同样剥离 YAML 头——
    // 此前它会作为字面 Markdown 泄漏进正文。
    const parsedFm = parseFrontmatter(source);
    if (!dialect && parsedFm.error) {
      console.warn(
        `Warning: invalid frontmatter in ${entry.file} (${parsedFm.error}); rendering without it`
      );
    }
    const fm = frontmatterContext(parsedFm.data, {
      dateFormat,
      filePath: absPath,
      fallbackModified: fmDatesFallback
    });

    // title_as_heading：无一级标题的章节以 fm.title 注入 h1（锚点/目录/
    // 书签/running 锚点全部照常生成）。已有 h1 的章节不受影响。
    let fmBody = parsedFm.body;
    if (
      fmTitleAsHeading &&
      fm.derived.title &&
      !/^ {0,3}#(?!#)\s+\S/m.test(fmBody) &&
      !/^\S.*\r?\n {0,3}=+\s*$/m.test(fmBody)
    ) {
      fmBody = `# ${fm.derived.title}\n\n${fmBody}`;
      source = source.slice(0, source.length - parsedFm.body.length) + fmBody;
    }

    // docId 用于给脚注 ID 加章节前缀，避免跨章节 ID 冲突
    const env = {
      docId: `ch${i + 1}`,
      chapterDir: path.dirname(absPath),
      ...(dialect
        ? { obsidianFile: absPath, obsidianStack: [absPath], obsidianTransclusion: false }
        : {})
    };
    const headingStart = tocEntries.length;
    // 方言路径消费完整 source（自行剥离头部）；标准方言渲染剥离后的正文
    const dialectRender = dialect ? renderDialectSource(source, env) : null;
    let bodyHtml = dialectRender?.html ?? md.render(fmBody, env);
    const sectionHeadingId = tocEntries[headingStart]?.id ?? "";
    const chapterH1Title =
      tocEntries[headingStart]?.level === 1 ? tocEntries[headingStart].title : "";
    if (
      !sectionHeadingId &&
      entry.running?.custom
    ) {
      console.warn(
        `Warning: ${entry.file} cannot apply its running header/footer policy ` +
          "because the Markdown page has no heading anchor."
      );
    }

    // 章标题下方的 frontmatter byline（meta band），其后是可选的章节小目录。
    const metaKeys = isInsert ? false : entry.meta !== undefined ? entry.meta : fmGlobalMeta;
    const metaBand =
      Array.isArray(metaKeys) && metaKeys.length > 0
        ? chapterMetaHtml(metaKeys, fm, { labels: fmLabels })
        : "";

    // Optional per-chapter mini TOC, inserted right after the chapter's h1.
    const wantChapterToc =
      !isInsert && (entry.chapterToc === null ? chapterTocDefault : entry.chapterToc);
    const miniToc = wantChapterToc
      ? buildChapterToc(tocEntries.slice(headingStart), {
          title: chapterTocTitle,
          depth: chapterTocDepth,
          className: chapterTocClass
        })
      : "";
    const afterH1 = [metaBand, miniToc].filter(Boolean).join("\n");
    if (afterH1) {
      bodyHtml = /<\/h1>/.test(bodyHtml)
        ? bodyHtml.replace("</h1>", `</h1>\n${afterH1}`)
        : afterH1 + bodyHtml;
    }

    // 主目录控制：insert 页与 toc: false 的章节不进主目录（锚点与 PDF
    // 书签保留）；toc: "文案" 覆盖本章 h1 在主目录里的行文案。
    if (isInsert || entry.toc === false) {
      tocEntries.splice(headingStart);
    } else if (typeof entry.toc === "string") {
      const first = tocEntries[headingStart];
      if (first && first.level === 1) first.title = entry.toc;
    }

    // Navigation level is independent from Markdown heading depth. Apply it
    // after the optional label override (which identifies the original h1).
    const navigationLevel = entry.navigation?.level ?? 1;
    if (navigationLevel !== 1) {
      for (const item of tocEntries.slice(headingStart)) {
        item.level = Math.min(6, navigationLevel + Math.max(0, item.level - 1));
      }
    }


    if (entry.navigation?.outline === false) {
      bodyHtml = bodyHtml.replace(/<h([1-6])\b(?![^>]*\brole=)/g, '<h$1 role="paragraph"');
    }

    // 章节 cover 页：正文前的一整页，内容取自 frontmatter（缺省回退章 h1）。
    // 先构建、先推入，使其位于章节 section 之前；若为首个正文条目，
    // cover 消费 hb-lead（紧随封面/目录，不产生空页）。
    if (entry.cover) {
      coverSeq += 1;
      const warn = fmWarn(entry.file);
      const coverTitle =
        entry.cover.title !== undefined
          ? resolveFmPlaceholders(entry.cover.title, fm.values, { warn })
          : fm.derived.title || chapterH1Title;
      const coverSubtitle =
        entry.cover.subtitle !== undefined
          ? resolveFmPlaceholders(entry.cover.subtitle, fm.values, { warn })
          : fm.derived.subtitle;
      let metaLines;
      let coverTags = [];
      if (entry.cover.metaLines) {
        metaLines = entry.cover.metaLines
          .map((line) => resolveFmPlaceholders(line, fm.values, { warn }).trim())
          .filter(Boolean);
      } else {
        // 默认元信息：作者行 + 创建/更新行 + 标签胶囊
        const dateBits = [
          fm.derived.created && `${fmLabels.created ?? "Created"} ${fm.derived.created}`,
          fm.derived.modified && `${fmLabels.modified ?? "Updated"} ${fm.derived.modified}`
        ].filter(Boolean);
        metaLines = [
          fm.derived.authorsList.join(", "),
          dateBits.join(" · ")
        ].filter(Boolean);
        coverTags = fm.derived.tagsList;
      }
      if (entry.cover.bleed && !sectionHeadingId) {
        warn("cover.bleed needs the chapter's top-level heading anchor; rendering without full bleed");
      }
      sections.push(
        chapterCoverHtml(
          { ...entry.cover, bleed: Boolean(entry.cover.bleed && sectionHeadingId) },
          {
            seq: coverSeq,
            anchorId: sectionHeadingId,
            title: coverTitle,
            subtitle: coverSubtitle,
            metaLines,
            tags: coverTags,
            lead: leadClass()
          }
        )
      );
    }

    // running 槽位中的 {{fm.*}} 按本章 frontmatter 在构建期解析
    const entryForAttrs = entry.running?.custom
      ? { ...entry, running: resolveRunningFm(entry.running, fm.values, fmWarn(entry.file)) }
      : entry;

    const cls = [
      isInsert ? "insert" : "chapter",
      entry.className,
      ...entryFlowClasses(entry),
      ...(dialectRender?.prepared.cssClasses ?? [])
    ]
      .filter(Boolean)
      .join(" ");
    const dataAttr = isInsert ? "data-entry" : "data-chapter";
    sections.push(
      `<section class="${cls}${leadClass()}" ${dataAttr}="${i + 1}"${entryDataAttributes(entryForAttrs, sectionHeadingId)}>\n${wrapWithRunningHeader(bodyHtml)}</section>`
    );
  });

  /* ----- CSS：变量覆盖 + @page + 自定义 CSS ----- */

  const fonts = styleCfg.fonts ?? {};
  const overrideCss = buildOverrideCss({
    styleCfg,
    pdfCfg,
    coverCfg,
    backCfg,
    coverEnabled,
    coverUsesHeaderFooter
  });

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

  const inlineCss = assembleInlineCss({ katexCss, printCss, overrideCss, customCss });

  /* ----- 封面 / 封底组件 ----- */

  const coverHtml = buildCoverHtml({
    enabled: coverEnabled,
    cfg: coverCfg,
    metaValues,
    hasVersion: Boolean(bookVersion),
    loadComponent
  });

  const backCoverHtml = buildBackCoverHtml({
    enabled: backEnabled,
    cfg: backCfg,
    metaValues,
    hasVersion: Boolean(bookVersion),
    loadComponent
  });

  /* ----- 写出 HTML ----- */

  // 浏览器标签页标题：非默认主题附加主题名，便于区分
  const docTitle = theme.isDefault ? title : `${title} · ${theme.label || theme.name}`;

  // 目录页同样带运行页眉（封面/封底不带）
  let tocRaw = buildToc(tocEntries, { enabled: tocEnabled, title: tocTitle, depth: tocDepth });
  if (hasInFlowContents && tocRaw) {
    // 标记 in-flow：render-pdf 据此把目录当作正文页计页
    //（count_toc: false 对流内目录不适用——拼接机制假设目录紧随封面）。
    tocRaw = tocRaw.replace('<nav class="toc" id="toc">', '<nav class="toc" id="toc" data-hb-in-flow="true">');
  }
  const wrappedToc = tocRaw
    ? tocRaw.replace(
        /^(<nav class="toc" id="toc"[^>]*>\n)([\s\S]*)(\n<\/nav>)$/,
        (whole, open, inner, close) => open + wrapWithRunningHeader(inner) + close
      )
    : "";

  let tocHtml = wrappedToc;
  let joinedSections = sections.join("\n\n");
  if (hasInFlowContents) {
    if (!tocRaw && theme.isDefault) {
      console.warn(
        'Warning: "contents: true" has no effect — the TOC is disabled or empty (toc.enabled).'
      );
    }
    if ((pdfCfg.page_numbers?.count_toc ?? true) === false && theme.isDefault) {
      console.warn(
        "Warning: an in-flow contents page is always counted in page numbering; " +
          "ignoring pdf.page_numbers.count_toc: false."
      );
    }
    joinedSections = joinedSections.replace(CONTENTS_SLOT_MARKER, wrappedToc);
    tocHtml = ""; // 模板的 {{toc}} 槽位空置
  }

  const bodyHtml = dialect ? dialect.finalizeLinks(joinedSections) : joinedSections;
  const dialectScripts = dialectClientScripts(dialect);

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

  return { theme, htmlOutTheme, pdfOutTheme, styleCfg, fonts, tocEntries, dialect };
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

if (defaultBuild.dialect) {
  defaultBuild.dialect.copyReferencedFiles(distDir);
}

// 警告跨主题聚合去重：每个主题独立渲染一遍，内容级警告一般相同，
// 但只报默认主题的会漏掉主题差异引出的问题。
const dialectWarnings = new Set(built.flatMap((item) => [...(item.dialect?.warnings ?? [])]));
for (const warning of dialectWarnings) {
  console.warn(`Warning: ${warning}`);
}

copyDialectRuntimeAssets(built.map((item) => item.dialect), distDir, require);

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
