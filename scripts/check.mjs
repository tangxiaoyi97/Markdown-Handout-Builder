#!/usr/bin/env node
/**
 * scripts/check.mjs
 *
 * 构建前检查：
 *   1. book.yml 存在、可解析；structure/chapters 归一化成功；
 *   2. 文件、layout/part/include、flow/navigation/running 策略合法；
 *   3. 章节（仅 .md）按方言检查：默认拒绝 Obsidian 语法，obsidian 模式
 *      解析 properties 并验证 wikilink / embed 目标；
 *   4. 章节的本地图片引用必须存在（相对当前 Markdown 文件所在目录解析）；
 *   5. toc / chapter_toc / pdf / themes / labels 等配置字段类型校验。
 *
 * 说明：围栏代码块（``` / ~~~）和行内代码 `...` 中的内容不参与
 * wikilink / 图片检查，避免误报（例如 bash 的 [[ ]]）。
 *
 * 任一错误：打印全部错误并 process.exit(1)。
 * 全部通过：打印 "Check passed"。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChapters, isValidClassAttr } from "./lib/chapters.mjs";
import {
  obsidianFragmentExists,
  parseObsidianFrontmatter,
  scanObsidianReferences
} from "./lib/obsidian.mjs";
import { toPosix } from "./lib/util.mjs";
import { resolveConfigPath, loadBook } from "./lib/config.mjs";
import { resolveDialectConfig, createDialectVault } from "./lib/dialects.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(scriptDir, "..");

const configPath = resolveConfigPath();
const baseDir = path.dirname(configPath);
const configName = path.basename(configPath);

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);

// 被章节引用过的本地图片（用于"未引用图片"警告）
const referencedImages = new Set();
const checkedMarkdownContent = new Set();
const embeddedNotes = new Set();

/* ---------- 1. 读取并解析 book.yml ---------- */

const book = loadBook(configPath);

const isMapping = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const TOP_LEVEL_KEYS = new Set([
  "title", "subtitle", "language", "date", "date_format", "version",
  "authors", "keywords", "chapters", "structure", "layouts", "output",
  "toc", "chapter_toc", "pdf", "style", "cover", "back_cover", "themes",
  "labels", "markdown", "frontmatter", "numbering"
]);
for (const key of Object.keys(book)) {
  if (!TOP_LEVEL_KEYS.has(key)) {
    fail(`${configName}: unknown top-level key ${JSON.stringify(key)}.`);
  }
}

if (
  book.title === undefined ||
  book.title === null ||
  !["string", "number"].includes(typeof book.title) ||
  !String(book.title).trim()
) {
  fail(`${configName}: "title" is required and must be a non-empty string or number.`);
}
for (const key of ["subtitle", "date"]) {
  if (
    book[key] !== undefined &&
    book[key] !== null &&
    !["string", "number"].includes(typeof book[key])
  ) {
    fail(`${configName}: "${key}" must be a string or number.`);
  }
}
if (
  book.language !== undefined &&
  (typeof book.language !== "string" || !book.language.trim())
) {
  fail(`${configName}: "language" must be a non-empty string.`);
}
if (book.authors !== undefined) {
  const validAuthor = (value) => ["string", "number"].includes(typeof value);
  if (!(validAuthor(book.authors) || (Array.isArray(book.authors) && book.authors.every(validAuthor)))) {
    fail(`${configName}: "authors" must be a string/number or a list of them.`);
  }
}
if (
  book.keywords !== undefined &&
  (!Array.isArray(book.keywords) ||
    book.keywords.some((value) => !["string", "number"].includes(typeof value)))
) {
  fail(`${configName}: "keywords" must be a list of strings or numbers.`);
}

if (book.output !== undefined) {
  if (!isMapping(book.output)) {
    fail(`${configName}: "output" must be a mapping with optional html/pdf paths.`);
  } else {
    for (const key of Object.keys(book.output)) {
      if (!["html", "pdf"].includes(key)) {
        fail(`${configName}: output.${key}: unknown key (use html / pdf).`);
      }
    }
    for (const key of ["html", "pdf"]) {
      if (
        book.output[key] !== undefined &&
        (typeof book.output[key] !== "string" || !book.output[key].trim())
      ) {
        fail(`${configName}: output.${key} must be a non-empty path string.`);
      }
    }
  }
}

if (book.toc !== undefined) {
  if (!isMapping(book.toc)) {
    fail(`${configName}: "toc" must be a mapping (enabled / title / depth).`);
  } else {
    for (const key of Object.keys(book.toc)) {
      if (!["enabled", "title", "depth"].includes(key)) {
        fail(`${configName}: toc.${key}: unknown key (use enabled / title / depth).`);
      }
    }
    if (book.toc.enabled !== undefined && typeof book.toc.enabled !== "boolean") {
      fail(`${configName}: toc.enabled must be true or false.`);
    }
    if (
      book.toc.title !== undefined &&
      !["string", "number"].includes(typeof book.toc.title)
    ) {
      fail(`${configName}: toc.title must be a string or number.`);
    }
    if (
      book.toc.depth !== undefined &&
      (!Number.isInteger(book.toc.depth) || book.toc.depth < 1 || book.toc.depth > 3)
    ) {
      fail(`${configName}: toc.depth must be an integer between 1 and 3.`);
    }
  }
}

/* ---------- Markdown dialect ---------- */

// 归一化与校验和 build.mjs 共用 lib/dialects.mjs；check 收集错误继续跑
const dialectCfg = resolveDialectConfig(book, baseDir);
for (const message of dialectCfg.errors) fail(`${configName}: ${message}`);
const obsidianEnabled = dialectCfg.enabled;
const obsidianVault = createDialectVault(dialectCfg);

/* ---------- 2. structure / chapters：归一化为扁平文档流 ---------- */

const structureResult = normalizeChapters(book, baseDir);
for (const message of structureResult.errors ?? []) fail(`${configName}: ${message}`);
const structureEntries = structureResult.entries ?? [];
const structureKey = structureResult.key ?? (book.structure !== undefined ? "structure" : "chapters");

/* ---------- 3 & 4. 逐章检查 ---------- */

// 匹配 Markdown 图片：![alt](target ...)，target 可写成 <target>。
// 前置 "!" 保证不会匹配普通链接 [text](url)。
const IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)>\s]+)[^)]*\)/g;

function isRemoteTarget(target) {
  return /^(https?:)?\/\//i.test(target) || /^(data|mailto|ftp):/i.test(target);
}

function checkChapterContent(absPath, relPath) {
  if (obsidianEnabled && checkedMarkdownContent.has(absPath)) return;
  if (obsidianEnabled) checkedMarkdownContent.add(absPath);
  const text = fs.readFileSync(absPath, "utf8").replace(/^﻿/, ""); // 去 UTF-8 BOM
  const frontmatter = parseObsidianFrontmatter(text);
  if (frontmatter.error) {
    fail(
      `${relPath}: invalid ${obsidianEnabled ? "Obsidian properties" : "frontmatter"}: ` +
        frontmatter.error
    );
  }
  // Frontmatter is YAML metadata, not Markdown. Build strips it in every
  // dialect, so strict-syntax and image checks must inspect only the body.
  // Keep line numbers anchored to the source file for useful diagnostics.
  const lines = frontmatter.body.split(/\r?\n/);
  const lineOffset = frontmatter.lineOffset;

  let inFence = false;
  let fenceChar = "";

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1 + lineOffset;

    // 围栏代码块开/关（``` 或 ~~~）
    const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
      }
      return; // 围栏行本身不检查
    }
    if (inFence) return;

    // 去掉行内代码，避免误报
    const line = rawLine.replace(/`[^`]*`/g, "");

    // Obsidian 专有语法
    if (!obsidianEnabled && line.includes("![[")) {
      fail(
        `${relPath}:${lineNo}: Obsidian embed "![[...]]" is not supported. ` +
          `Use a standard Markdown image like ![alt](./assets/pic.png).`
      );
    } else if (!obsidianEnabled && (line.includes("[[") || line.includes("]]"))) {
      fail(
        `${relPath}:${lineNo}: Obsidian wikilink "[[...]]" is not supported. ` +
          `Use a standard Markdown link like [text](target).`
      );
    }

    // 本地图片存在性检查
    for (const match of line.matchAll(IMAGE_RE)) {
      const rawTarget = match[1];
      if (isRemoteTarget(rawTarget)) continue; // 远程图片跳过

      let target = rawTarget.split("#")[0].split("?")[0];
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        // 保留原样
      }

      const resolved = path.resolve(path.dirname(absPath), target);
      if (!fs.existsSync(resolved)) {
        fail(
          `${relPath}:${lineNo}: image not found: ${rawTarget} ` +
            `(resolved to ${toPosix(path.relative(baseDir, resolved))})`
        );
      } else {
        referencedImages.add(resolved);
      }
    }
  });

  if (obsidianEnabled && obsidianVault) {
    for (const reference of scanObsidianReferences(text, { includeFrontmatter: true })) {
      const resolved = obsidianVault.resolve(reference.target, absPath);
      if (!resolved) {
        fail(
          `${relPath}:${reference.line}: Obsidian ${reference.embed ? "embed" : "link"} target not found: ` +
            `${reference.target || `#${reference.fragment}`}`
        );
        continue;
      }
      if (resolved.ambiguous.length > 0) {
        warnings.push(
          `${relPath}:${reference.line}: ambiguous Obsidian target ${JSON.stringify(reference.target)}; ` +
            `using ${resolved.file.relPath}`
        );
      }
      if (
        resolved.file.ext === ".md" &&
        reference.fragment &&
        !obsidianFragmentExists(resolved.file.absPath, reference.fragment)
      ) {
        fail(
          `${relPath}:${reference.line}: Obsidian fragment not found: ` +
            `${resolved.file.relPath}#${reference.fragment}`
        );
      }
      if (reference.embed && resolved.file.ext !== ".md") {
        referencedImages.add(resolved.file.absPath);
      } else if (reference.embed) {
        embeddedNotes.add(resolved.file.absPath);
        checkChapterContent(resolved.file.absPath, resolved.file.relPath);
      }
    }
  }
}

const seenChapters = new Set();
const chapterResolvedPaths = []; // all listed entries' abs paths (orphan detection)
for (const entry of structureEntries) {
  // 声明式特殊页（无文件）：类型与字段已在归一化中校验
  if (entry.kind === "divider" || entry.kind === "blank") continue;
  if (entry.kind === "contents") {
    continue;
  }

  const absPath = path.resolve(baseDir, entry.file);
  if (seenChapters.has(absPath)) {
    fail(`${configName}: chapter listed more than once: ${entry.file}`);
    continue;
  }
  seenChapters.add(absPath);
  chapterResolvedPaths.push(absPath);

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    const kind = entry.kind === "insert" ? "insert" : "chapter";
    fail(`${configName}: ${kind} file not found: ${entry.file}`);
    continue;
  }

  // Per-entry CSS class(es), when the object form is used
  if (entry.className && !isValidClassAttr(entry.className)) {
    fail(
      `${configName}: invalid class ${JSON.stringify(entry.className)} for ${entry.file} ` +
        `(space-separated tokens, each matching [A-Za-z_-][A-Za-z0-9_-]*).`
    );
  }

  // chapter_toc only applies to Markdown chapters
  if (entry.kind === "insert" && entry.chapterToc !== null) {
    warnings.push(`${entry.file}: chapter_toc is ignored on an insert page`);
  }

  // Wikilink / local-image checks apply to every Markdown page (chapters and
  // as:insert pages alike). Raw HTML inserts are trusted, author-controlled.
  if (entry.format === "markdown") {
    if (entry.cover?.bleed) {
      const source = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
      const hasAtxH1 = /^ {0,3}#(?!#)\s+\S.*$/m.test(source);
      const hasSetextH1 = /^\S.*\r?\n {0,3}=+\s*$/m.test(source);
      // frontmatter.title_as_heading 开启时，无 h1 的章节可由 fm.title 注入标题
      const canInjectTitle =
        book.frontmatter?.title_as_heading === true &&
        Boolean(parseObsidianFrontmatter(source).data?.title);
      if (!hasAtxH1 && !hasSetextH1 && !canInjectTitle) {
        fail(`${entry.file}: cover.bleed requires a top-level Markdown heading`);
      }
    }
    checkChapterContent(absPath, toPosix(entry.file));
  }
}

// in-flow contents 与目录/页码配置的组合
if (structureEntries.some((entry) => entry.kind === "contents")) {
  if (book.toc?.enabled === false) {
    warnings.push('"contents: true" has no effect while toc.enabled is false');
  }
  if (book.pdf?.page_numbers?.count_toc === false) {
    warnings.push(
      "an in-flow contents page is always counted in page numbering; " +
        "pdf.page_numbers.count_toc: false is ignored"
    );
  }
}

/* ---------- vault 内其余笔记的 properties 健康检查 ---------- */

// 章节与被嵌入的笔记在上面已作为错误报告；vault 里其余 .md 的坏
// frontmatter 不会阻断构建，但很可能是作者失误——降级为警告提示。
if (obsidianEnabled && obsidianVault) {
  for (const record of obsidianVault.files) {
    if (record.frontmatterError && !checkedMarkdownContent.has(record.absPath)) {
      warnings.push(
        `${record.relPath}: invalid Obsidian properties: ${record.frontmatterError}`
      );
    }
  }
}

/* ---------- themes 与引用文件路径校验 ---------- */

if (book.themes !== undefined) {
  if (!Array.isArray(book.themes) || book.themes.length === 0) {
    fail(`${configName}: "themes" must be a non-empty array (or be removed entirely).`);
  } else {
    const seenNames = new Set();
    let defaultCount = 0;
    book.themes.forEach((theme, i) => {
      const label = `themes[${i}]`;
      if (!isMapping(theme)) {
        fail(`${configName}: ${label} must be a mapping with at least a "name".`);
        return;
      }
      for (const key of Object.keys(theme)) {
        if (!["name", "label", "default", "style", "cover", "back_cover", "pdf"].includes(key)) {
          fail(
            `${configName}: ${label}.${key}: unknown key ` +
              "(use name / label / default / style / cover / back_cover / pdf)."
          );
        }
      }
      const name = theme.name;
      if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
        fail(
          `${configName}: ${label}.name must match [A-Za-z0-9][A-Za-z0-9_-]* ` +
            `(used in output filenames), got: ${JSON.stringify(name)}`
        );
      } else if (seenNames.has(name)) {
        fail(`${configName}: duplicate theme name "${name}".`);
      } else {
        seenNames.add(name);
      }
      if (theme.label !== undefined && typeof theme.label !== "string") {
        fail(`${configName}: ${label}.label must be a string.`);
      }
      if (theme.default !== undefined && typeof theme.default !== "boolean") {
        fail(`${configName}: ${label}.default must be true or false.`);
      }
      if (theme.default === true) defaultCount += 1;
    });
    if (defaultCount > 1) {
      fail(`${configName}: only one theme may have "default: true" (found ${defaultCount}).`);
    }
  }
}

const STYLE_KEYS = new Set([
  "accent_color", "content_width", "base_font_size", "print_font_size",
  "fonts", "custom_css"
]);
const COVER_KEYS = new Set(["enabled", "html", "background", "color"]);

function checkStyleConfig(scope, where) {
  const style = scope?.style;
  if (style === undefined) return;
  if (!isMapping(style)) {
    fail(`${configName}: ${where}style must be a mapping.`);
    return;
  }
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) fail(`${configName}: ${where}style.${key}: unknown key.`);
  }
  for (const key of ["accent_color", "content_width", "base_font_size", "print_font_size"]) {
    if (style[key] !== undefined && (typeof style[key] !== "string" || !style[key].trim())) {
      fail(`${configName}: ${where}style.${key} must be a non-empty CSS value string.`);
    }
  }
  if (style.fonts !== undefined) {
    if (!isMapping(style.fonts)) {
      fail(`${configName}: ${where}style.fonts must be a mapping.`);
    } else {
      for (const [key, value] of Object.entries(style.fonts)) {
        if (!["body", "heading", "code"].includes(key)) {
          fail(`${configName}: ${where}style.fonts.${key}: unknown key (use body / heading / code).`);
        } else if (typeof value !== "string" || !value.trim()) {
          fail(`${configName}: ${where}style.fonts.${key} must be a non-empty string.`);
        }
      }
    }
  }
  if (style.custom_css !== undefined) {
    const files = Array.isArray(style.custom_css) ? style.custom_css : [style.custom_css];
    if (files.length === 0 || files.some((file) => typeof file !== "string" || !file.trim())) {
      fail(`${configName}: ${where}style.custom_css must be a path string or non-empty path list.`);
    }
  }
}

function checkCoverConfig(scope, where) {
  for (const key of ["cover", "back_cover"]) {
    const cover = scope?.[key];
    if (cover === undefined) continue;
    if (!isMapping(cover)) {
      fail(`${configName}: ${where}${key} must be a mapping.`);
      continue;
    }
    for (const option of Object.keys(cover)) {
      if (!COVER_KEYS.has(option)) {
        fail(`${configName}: ${where}${key}.${option}: unknown key.`);
      }
    }
    if (cover.enabled !== undefined && typeof cover.enabled !== "boolean") {
      fail(`${configName}: ${where}${key}.enabled must be true or false.`);
    }
    for (const option of ["html", "background", "color"]) {
      if (
        cover[option] !== undefined &&
        (typeof cover[option] !== "string" || !cover[option].trim())
      ) {
        fail(`${configName}: ${where}${key}.${option} must be a non-empty string.`);
      }
    }
  }
}

checkStyleConfig(book, "");
checkCoverConfig(book, "");
if (Array.isArray(book.themes)) {
  book.themes.forEach((theme, i) => {
    checkStyleConfig(theme, `themes[${i}].`);
    checkCoverConfig(theme, `themes[${i}].`);
  });
}

// 配置中引用的文件必须存在（custom_css / 封面封底组件），基础配置与各主题都查
function checkReferencedFiles(scope, where) {
  if (!scope || typeof scope !== "object") return;
  const cssRaw = scope.style?.custom_css;
  const cssList = Array.isArray(cssRaw) ? cssRaw : cssRaw ? [cssRaw] : [];
  for (const file of cssList) {
    const projectPath = path.resolve(baseDir, String(file));
    const toolPath = path.resolve(toolRoot, String(file));
    if (!fs.existsSync(projectPath) && !fs.existsSync(toolPath)) {
      fail(`${configName}: ${where}style.custom_css file not found: ${file}`);
    }
  }
  for (const [section, key] of [["cover", "cover"], ["back_cover", "back_cover"]]) {
    const html = scope[section]?.html;
    if (html && !fs.existsSync(path.resolve(baseDir, String(html)))) {
      fail(`${configName}: ${where}${key}.html component not found: ${html}`);
    }
  }
}

checkReferencedFiles(book, "");
if (Array.isArray(book.themes)) {
  book.themes.forEach((theme, i) => checkReferencedFiles(theme, `themes[${i}].`));
}

/* ---------- pdf 页眉页脚 / 页码 / 日期格式配置校验 ---------- */

const KNOWN_PLACEHOLDERS = new Set([
  "page", "total", "title", "subtitle", "authors", "author", "date", "rawDate",
  "version", "commit", "lang", "theme", "chapterTitle", "sectionTitle"
]);
const KNOWN_HF_STYLE_KEYS = new Set(["font_size", "color", "font_family", "offset"]);

for (const entry of structureEntries) {
  if (!entry.running?.custom) continue;
  const label = entry.file ?? entry.title ?? entry.kind;
  for (const band of ["header", "footer"]) {
    const slots = entry.running[band];
    if (!slots || typeof slots !== "object") continue;
    for (const [slot, value] of Object.entries(slots)) {
      for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
        if (!KNOWN_PLACEHOLDERS.has(match[1])) {
          warnings.push(
            `${label}: running.${band}.${slot}: unknown placeholder {{${match[1]}}} ` +
              "(kept as literal text)"
          );
        }
      }
    }
  }
}

if (book.date_format !== undefined && typeof book.date_format !== "string") {
  fail(`${configName}: "date_format" must be a string (e.g. "YYYY-MM-DD").`);
}

if (
  book.version !== undefined &&
  book.version !== null &&
  !["string", "number"].includes(typeof book.version)
) {
  fail(`${configName}: "version" must be a string or number (e.g. "v2", "Rev. B").`);
}


function checkPdfConfig(scope, where) {
  const pdf = scope?.pdf;
  if (pdf === undefined) return;
  if (!isMapping(pdf)) {
    fail(`${configName}: ${where}pdf must be a mapping.`);
    return;
  }

  const knownPdfKeys = new Set([
    "header_footer", "toc_page_numbers", "cover_header_footer", "page_size",
    "margin", "date_format", "page_numbers", "header", "footer",
    "header_footer_style"
  ]);
  for (const key of Object.keys(pdf)) {
    if (!knownPdfKeys.has(key)) {
      fail(`${configName}: ${where}pdf.${key}: unknown key.`);
    }
  }
  for (const key of ["header_footer", "toc_page_numbers", "cover_header_footer"]) {
    if (pdf[key] !== undefined && typeof pdf[key] !== "boolean") {
      fail(`${configName}: ${where}pdf.${key} must be true or false.`);
    }
  }
  for (const key of ["page_size", "margin"]) {
    if (pdf[key] !== undefined && (typeof pdf[key] !== "string" || !pdf[key].trim())) {
      fail(`${configName}: ${where}pdf.${key} must be a non-empty string.`);
    }
  }

  if (pdf.date_format !== undefined && typeof pdf.date_format !== "string") {
    fail(`${configName}: ${where}pdf.date_format must be a string.`);
  }

  const pn = pdf.page_numbers;
  if (pn !== undefined) {
    if (!isMapping(pn)) {
      fail(`${configName}: ${where}pdf.page_numbers must be a mapping.`);
    } else {
      for (const key of Object.keys(pn)) {
        if (!["format", "count_cover", "count_toc", "count_back_cover"].includes(key)) {
          fail(`${configName}: ${where}pdf.page_numbers.${key}: unknown key.`);
        }
      }
      if (pn.format !== undefined && typeof pn.format !== "string") {
        fail(`${configName}: ${where}pdf.page_numbers.format must be a string.`);
      }
      for (const key of ["count_cover", "count_toc", "count_back_cover"]) {
        if (pn[key] !== undefined && typeof pn[key] !== "boolean") {
          fail(`${configName}: ${where}pdf.page_numbers.${key} must be true or false.`);
        }
      }
      if (typeof pn.format === "string") {
        for (const m of pn.format.matchAll(/\{\{(\w+)\}\}/g)) {
          if (!KNOWN_PLACEHOLDERS.has(m[1])) {
            warnings.push(
              `${where}pdf.page_numbers.format: unknown placeholder {{${m[1]}}} (kept as literal text)`
            );
          }
        }
      }
    }
  }

  for (const section of ["header", "footer"]) {
    const slots = pdf[section];
    if (slots === undefined) continue;
    if (!isMapping(slots)) {
      fail(`${configName}: ${where}pdf.${section} must be a mapping with left/center/right.`);
      continue;
    }
    for (const [slot, value] of Object.entries(slots)) {
      if (!["left", "center", "right"].includes(slot)) {
        fail(
          `${configName}: ${where}pdf.${section}.${slot}: ` +
            "unknown slot (use left / center / right)."
        );
        continue;
      }
      if (typeof value !== "string") {
        fail(`${configName}: ${where}pdf.${section}.${slot} must be a string.`);
        continue;
      }
      // fm 占位符按章取值，只在每条目的 running 策略（或章节 cover）中有意义
      if (/\{\{\s*(?:fm|frontmatter)\./.test(value)) {
        fail(
          `${configName}: ${where}pdf.${section}.${slot}: {{fm.*}} placeholders are per-chapter — ` +
            "move them into an entry's (or layout's) running policy."
        );
        continue;
      }
      for (const m of value.matchAll(/\{\{(\w+)\}\}/g)) {
        if (!KNOWN_PLACEHOLDERS.has(m[1])) {
          warnings.push(
            `${where}pdf.${section}.${slot}: unknown placeholder {{${m[1]}}} (kept as literal text)`
          );
        }
      }
    }
  }

  const hfs = pdf.header_footer_style;
  if (hfs !== undefined) {
    if (!isMapping(hfs)) {
      fail(`${configName}: ${where}pdf.header_footer_style must be a mapping.`);
    } else {
      for (const [key, value] of Object.entries(hfs)) {
        if (!KNOWN_HF_STYLE_KEYS.has(key)) {
          fail(`${configName}: ${where}pdf.header_footer_style.${key}: unknown key.`);
        } else if (typeof value !== "string" || !value.trim()) {
          fail(
            `${configName}: ${where}pdf.header_footer_style.${key} ` +
              "must be a non-empty string."
          );
        }
      }
    }
  }
}

checkPdfConfig(book, "");
if (Array.isArray(book.themes)) {
  book.themes.forEach((theme, i) => checkPdfConfig(theme, `themes[${i}].`));
}

/* ---------- frontmatter 集成配置校验 ---------- */

if (book.frontmatter !== undefined) {
  const fm = book.frontmatter;
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    fail(`${configName}: "frontmatter" must be a mapping.`);
  } else {
    const known = new Set(["title_as_heading", "meta", "labels", "dates"]);
    for (const key of Object.keys(fm)) {
      if (!known.has(key)) {
        fail(`${configName}: frontmatter.${key}: unknown key (use title_as_heading / meta / labels / dates).`);
      }
    }
    if (fm.title_as_heading !== undefined && typeof fm.title_as_heading !== "boolean") {
      fail(`${configName}: frontmatter.title_as_heading must be true or false.`);
    }
    if (fm.meta !== undefined && fm.meta !== false) {
      if (!Array.isArray(fm.meta) || fm.meta.some((key) => typeof key !== "string" || !key.trim())) {
        fail(`${configName}: frontmatter.meta must be false or a list of frontmatter keys.`);
      }
    }
    if (fm.labels !== undefined) {
      if (!fm.labels || typeof fm.labels !== "object" || Array.isArray(fm.labels)) {
        fail(`${configName}: frontmatter.labels must be a mapping of key -> display text.`);
      } else {
        for (const [key, value] of Object.entries(fm.labels)) {
          if (typeof value !== "string") {
            fail(`${configName}: frontmatter.labels.${key} must be a string.`);
          }
        }
      }
    }
    if (fm.dates !== undefined) {
      if (!fm.dates || typeof fm.dates !== "object" || Array.isArray(fm.dates)) {
        fail(`${configName}: frontmatter.dates must be a mapping.`);
      } else {
        for (const key of Object.keys(fm.dates)) {
          if (key !== "fallback_modified") {
            fail(`${configName}: frontmatter.dates.${key}: unknown key (use fallback_modified).`);
          }
        }
        if (
          fm.dates.fallback_modified !== undefined &&
          !["none", "file"].includes(String(fm.dates.fallback_modified))
        ) {
          fail(`${configName}: frontmatter.dates.fallback_modified must be "none" or "file".`);
        }
      }
    }
  }
}

/* ---------- labels / numbering 配置校验 ---------- */

// 内置标签键（可覆盖显示文本）；其余键 = 自定义容器（进 ::: 语法与 CSS class，
// 必须是安全的 ASCII 标识符）。pagebreak 为保留字。值一律为字符串——
// 工具不做任何自动编号，编号由作者直接写在标题/名称/图注/\tag 里。
const BUILTIN_LABEL_KEYS = new Set([
  "note", "tip", "warning", "danger",
  "theorem", "definition", "example", "exercise"
]);
if (book.labels !== undefined) {
  if (!book.labels || typeof book.labels !== "object" || Array.isArray(book.labels)) {
    fail(`${configName}: "labels" must be a mapping (e.g. labels: { note: "注意" }).`);
  } else {
    for (const [key, value] of Object.entries(book.labels)) {
      if (typeof value !== "string") {
        fail(`${configName}: labels.${key} must be a string.`);
        continue;
      }
      if (!BUILTIN_LABEL_KEYS.has(key)) {
        if (key === "pagebreak") {
          fail(`${configName}: labels.pagebreak is reserved and cannot be a custom container.`);
        } else if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
          fail(
            `${configName}: labels.${key}: custom container keys must match ` +
              `[A-Za-z][A-Za-z0-9_-]* (used as the ::: container name and CSS class).`
          );
        }
      }
    }
  }
}

// chapter_toc: 每章小目录的全局配置（default / title / depth / class）
if (book.chapter_toc !== undefined) {
  const ct = book.chapter_toc;
  if (!ct || typeof ct !== "object" || Array.isArray(ct)) {
    fail(`${configName}: "chapter_toc" must be a mapping (default / title / depth / class).`);
  } else {
    for (const key of Object.keys(ct)) {
      if (!["default", "title", "depth", "class"].includes(key)) {
        fail(
          `${configName}: chapter_toc.${key}: unknown key ` +
            "(use default / title / depth / class)."
        );
      }
    }
    if (ct.default !== undefined && typeof ct.default !== "boolean") {
      fail(`${configName}: chapter_toc.default must be true or false.`);
    }
    if (
      ct.title !== undefined &&
      ct.title !== null &&
      !["string", "number"].includes(typeof ct.title)
    ) {
      fail(`${configName}: chapter_toc.title must be a string.`);
    }
    if (
      ct.depth !== undefined &&
      (typeof ct.depth !== "number" || !Number.isInteger(ct.depth) || ct.depth < 2 || ct.depth > 6)
    ) {
      fail(`${configName}: chapter_toc.depth must be an integer between 2 and 6.`);
    }
    if (ct.class !== undefined && ct.class !== null && !isValidClassAttr(ct.class)) {
      fail(
        `${configName}: chapter_toc.class must be space-separated CSS class tokens ` +
          `([A-Za-z_-][A-Za-z0-9_-]*).`
      );
    }
  }
}

// numbering 已移除：编号由作者写在内容里（标题、环境名称、图注、\tag）
if (book.numbering !== undefined) {
  warnings.push(
    'numbering: this option was removed — write numbers directly in headings, ' +
      'environment names, figure captions, or KaTeX \\tag{...}'
  );
}

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

const chapterSet = new Set(chapterResolvedPaths);
const notesDir = path.join(baseDir, "notes");
const assetsDir = path.join(notesDir, "assets");

// notes/ 里存在、但 book.yml 没有收录的 Markdown（防止忘记收录）
if (fs.existsSync(notesDir)) {
  for (const file of walkFiles(notesDir)) {
    if (!file.endsWith(".md")) continue;
    if (path.basename(file).startsWith("_")) continue; // "_" 开头视为草稿，不提醒
    if (!chapterSet.has(file) && !embeddedNotes.has(file)) {
      warnings.push(
        `${toPosix(path.relative(baseDir, file))}: not listed in ${configName} "${structureKey}" — ` +
          `it will NOT appear in the handout (prefix the filename with "_" to mark it as a draft)`
      );
    }
  }
}

// notes/assets/ 里没有被任何章节引用的文件
if (fs.existsSync(assetsDir)) {
  for (const file of walkFiles(assetsDir)) {
    if (!referencedImages.has(file)) {
      warnings.push(
        `${toPosix(path.relative(baseDir, file))}: not referenced by any chapter (unused asset)`
      );
    }
  }
}

if (warnings.length > 0) {
  console.warn(`${warnings.length} warning(s):\n`);
  for (const message of warnings) {
    console.warn(`  ⚠ ${message}`);
  }
  console.warn("");
}

/* ---------- 结果 ---------- */

if (errors.length > 0) {
  console.error(`Check failed with ${errors.length} error(s):\n`);
  for (const message of errors) {
    console.error(`  ✗ ${message}`);
  }
  process.exit(1);
}

console.log("Check passed");
