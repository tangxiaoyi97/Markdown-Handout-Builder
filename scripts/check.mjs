#!/usr/bin/env node
/**
 * scripts/check.mjs
 *
 * 构建前检查：
 *   1. book.yml 存在、可解析；chapters 为非空列表或指向外部 .yml 列表文件；
 *   2. 每个条目按扩展名分派（.md/.markdown=章节，.html/.htm=插页），文件存在，
 *      对象形态的 class/chapter_toc 合法（chapter_toc 只对章节有意义）；
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
import YAML from "yaml";
import { resolveChapterList, normalizeChapterEntry, isValidClassAttr } from "./lib/chapters.mjs";
import {
  createObsidianVault,
  obsidianFragmentExists,
  parseObsidianFrontmatter,
  scanObsidianReferences
} from "./lib/obsidian.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(scriptDir, "..");

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

const configPath = resolveConfigPath();
const baseDir = path.dirname(configPath);
const configName = path.basename(configPath);

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const toPosix = (p) => p.split(path.sep).join("/");

// 被章节引用过的本地图片（用于"未引用图片"警告）
const referencedImages = new Set();
const checkedMarkdownContent = new Set();
const embeddedNotes = new Set();

/* ---------- 1. 读取并解析 book.yml ---------- */

if (!fs.existsSync(configPath)) {
  console.error(`Error: config file not found: ${configPath}`);
  process.exit(1);
}

let book;
try {
  book = YAML.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(`Error: failed to parse ${configName}: ${err.message}`);
  process.exit(1);
}

if (!book || typeof book !== "object") {
  console.error(`Error: ${configName} is empty or not a YAML mapping.`);
  process.exit(1);
}

/* ---------- Markdown dialect ---------- */

const markdownCfg = book.markdown ?? {};
let markdownDialect = "standard";
let obsidianEnabled = false;
let obsidianVault = null;
if (book.markdown !== undefined && (!book.markdown || typeof book.markdown !== "object" || Array.isArray(book.markdown))) {
  fail(`${configName}: "markdown" must be a mapping.`);
} else {
  markdownDialect = String(markdownCfg.dialect ?? "standard").toLowerCase();
  if (!["standard", "obsidian"].includes(markdownDialect)) {
    fail(`${configName}: markdown.dialect must be "standard" or "obsidian".`);
  }
  obsidianEnabled = markdownDialect === "obsidian";
}

if (obsidianEnabled) {
  const obsidianCfg = markdownCfg.obsidian ?? {};
  if (!obsidianCfg || typeof obsidianCfg !== "object" || Array.isArray(obsidianCfg)) {
    fail(`${configName}: markdown.obsidian must be a mapping.`);
  } else {
    const properties = String(obsidianCfg.properties ?? "visible").toLowerCase();
    if (!["visible", "hidden", "source"].includes(properties)) {
      fail(`${configName}: markdown.obsidian.properties must be "visible", "hidden", or "source".`);
    }
    if (obsidianCfg.vault_root !== undefined && typeof obsidianCfg.vault_root !== "string") {
      fail(`${configName}: markdown.obsidian.vault_root must be a directory path string.`);
    } else {
      const vaultRoot = path.resolve(baseDir, obsidianCfg.vault_root ?? ".");
      if (!fs.existsSync(vaultRoot) || !fs.statSync(vaultRoot).isDirectory()) {
        fail(`${configName}: markdown.obsidian.vault_root is not a directory: ${obsidianCfg.vault_root ?? "."}`);
      } else {
        obsidianVault = createObsidianVault(vaultRoot);
      }
    }
  }
}

/* ---------- 2. chapters：解析（内联列表或外部 chapters 文件） ---------- */

const chaptersResult = resolveChapterList(book, baseDir);
if (chaptersResult.error) {
  console.error(`Error: ${chaptersResult.error}`);
  process.exit(1);
}
const rawChapters = chaptersResult.list;
if (rawChapters.length === 0) {
  console.error(`Error: "chapters" in ${configName} must not be empty.`);
  process.exit(1);
}

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
  if (obsidianEnabled) {
    const frontmatter = parseObsidianFrontmatter(text);
    if (frontmatter.error) {
      fail(`${relPath}: invalid Obsidian properties: ${frontmatter.error}`);
    }
  }
  const lines = text.split(/\r?\n/);

  let inFence = false;
  let fenceChar = "";

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;

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
for (const raw of rawChapters) {
  const entry = normalizeChapterEntry(raw);
  if (entry.error) {
    fail(`${configName}: ${entry.error}`);
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
    warnings.push(`${entry.file}: chapter_toc is ignored on a .html insert page`);
  }

  // Wikilink / local-image checks only apply to Markdown chapters. Raw HTML
  // inserts are trusted, author-controlled fragments.
  if (entry.kind === "chapter") {
    checkChapterContent(absPath, toPosix(entry.file));
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
      if (!theme || typeof theme !== "object") {
        fail(`${configName}: ${label} must be a mapping with at least a "name".`);
        return;
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
      if (theme.default === true) defaultCount += 1;
    });
    if (defaultCount > 1) {
      fail(`${configName}: only one theme may have "default: true" (found ${defaultCount}).`);
    }
  }
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
  "version", "commit", "lang", "theme"
]);
const KNOWN_HF_STYLE_KEYS = new Set(["font_size", "color", "font_family", "offset"]);

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
  if (!pdf || typeof pdf !== "object") {
    fail(`${configName}: ${where}pdf must be a mapping.`);
    return;
  }

  if (pdf.date_format !== undefined && typeof pdf.date_format !== "string") {
    fail(`${configName}: ${where}pdf.date_format must be a string.`);
  }

  const pn = pdf.page_numbers;
  if (pn !== undefined) {
    if (!pn || typeof pn !== "object") {
      fail(`${configName}: ${where}pdf.page_numbers must be a mapping.`);
    } else {
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
    if (!slots || typeof slots !== "object") {
      fail(`${configName}: ${where}pdf.${section} must be a mapping with left/center/right.`);
      continue;
    }
    for (const [slot, value] of Object.entries(slots)) {
      if (!["left", "center", "right"].includes(slot)) {
        warnings.push(`${where}pdf.${section}.${slot}: unknown slot (use left / center / right)`);
        continue;
      }
      if (typeof value !== "string") {
        fail(`${configName}: ${where}pdf.${section}.${slot} must be a string.`);
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
    if (!hfs || typeof hfs !== "object") {
      fail(`${configName}: ${where}pdf.header_footer_style must be a mapping.`);
    } else {
      for (const key of Object.keys(hfs)) {
        if (!KNOWN_HF_STYLE_KEYS.has(key)) {
          warnings.push(`${where}pdf.header_footer_style.${key}: unknown key (ignored)`);
        }
      }
    }
  }
}

checkPdfConfig(book, "");
if (Array.isArray(book.themes)) {
  book.themes.forEach((theme, i) => checkPdfConfig(theme, `themes[${i}].`));
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
        `${toPosix(path.relative(baseDir, file))}: not listed in ${configName} "chapters" — ` +
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
