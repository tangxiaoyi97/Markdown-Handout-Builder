/**
 * scripts/lib/chapters.mjs
 *
 * Shared "chapters" normalization for build.mjs and check.mjs.
 *
 * Entry shapes (v2.1):
 *
 *   - string                      file path; role from the extension
 *       .md / .markdown  -> chapter  (rendered Markdown)
 *       .html / .htm     -> insert   (trusted raw-HTML page)
 *
 *   - { path, ... }               file entry with per-page options:
 *       as: chapter|insert        role override (.md may render as an insert
 *                                 page — preface/colophon written in Markdown;
 *                                 .html is always an insert)
 *       class: "a b"              extra CSS classes on the <section>
 *       chapter_toc: bool         per-chapter mini TOC (chapters only)
 *       toc: false | "label"      main-TOC control: exclude this chapter, or
 *                                 override its main-TOC row label
 *
 *   - { divider: {...} }          declared part-divider page (no file):
 *       title / subtitle / note   text lines (title becomes a real <h1> and
 *                                 a PDF bookmark)
 *       class                     CSS classes for custom styling
 *       background / color        inline page card colors (any CSS value)
 *       bleed: true               official PDF paints it edge-to-edge via the
 *                                 standalone-print overlay (requires title)
 *       toc: "label"              add a level-1 main-TOC row
 *
 *   - { blank: true | N }         intentionally blank page(s) (duplex layout)
 *
 *   - { contents: true }          place the main TOC at this position in the
 *                                 flow (at most once; TOC is then always
 *                                 counted in page numbering)
 *
 * Typos never fall through: exactly one type key per mapping entry, and
 * unknown keys are errors.
 *
 * The list itself may live inline under book.chapters, OR in a separate file
 * (book.chapters: "chapters.yml"), just like book.yml.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MD_EXTS = new Set([".md", ".markdown"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const CHAPTERS_FILE_EXTS = new Set([".yml", ".yaml"]);

// One or more space-separated CSS class tokens. Tokens start with a letter,
// "-" or "_" (never a digit) so they are valid HTML class attribute values.
const CLASS_TOKENS_RE = /^[A-Za-z_-][\w-]*(?:\s+[A-Za-z_-][\w-]*)*$/;

export function isValidClassAttr(value) {
  return CLASS_TOKENS_RE.test(String(value).trim());
}

/** "chapter" | "insert" | null (unrecognized extension). */
export function classifyChapterPath(p) {
  const ext = path.extname(String(p)).toLowerCase();
  if (MD_EXTS.has(ext)) return "chapter";
  if (HTML_EXTS.has(ext)) return "insert";
  return null;
}

/** "markdown" | "html" | null — how a path entry's content is rendered. */
export function chapterPathFormat(p) {
  const ext = path.extname(String(p)).toLowerCase();
  if (MD_EXTS.has(ext)) return "markdown";
  if (HTML_EXTS.has(ext)) return "html";
  return null;
}

/**
 * Resolve book.chapters into a raw list.
 * Returns { list } on success, or { error } (a message string).
 * A string value points to an external YAML file (a top-level list, or a
 * mapping with a "chapters:" list).
 */
export function resolveChapterList(book, baseDir) {
  const raw = book?.chapters;

  if (typeof raw === "string") {
    const ref = raw.trim();
    const ext = path.extname(ref).toLowerCase();
    if (!CHAPTERS_FILE_EXTS.has(ext)) {
      return {
        error:
          `"chapters" as a string must point to a .yml/.yaml file ` +
          `(got "${ref}"); use a list for inline chapters.`
      };
    }
    const filePath = path.resolve(baseDir, ref);
    if (!fs.existsSync(filePath)) {
      return { error: `chapters file not found: ${ref}` };
    }
    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      return { error: `failed to parse chapters file ${ref}: ${err.message}` };
    }
    const list = Array.isArray(doc) ? doc : doc?.chapters;
    if (!Array.isArray(list)) {
      return {
        error: `chapters file ${ref} must be a YAML list (or a mapping with a "chapters:" list).`
      };
    }
    return { list, source: ref };
  }

  if (Array.isArray(raw)) return { list: raw, source: null };

  return {
    error: `"chapters" must be a non-empty list of file paths, or a path to a .yml/.yaml chapters file.`
  };
}

const PATH_ENTRY_KEYS = new Set(["path", "as", "class", "chapter_toc", "toc"]);
const DIVIDER_KEYS = new Set(["title", "subtitle", "note", "class", "background", "color", "bleed", "toc"]);
const TYPE_KEYS = ["path", "divider", "blank", "contents"];

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((key) => !allowed.has(key));
}

// class 字段的通用归一化；invalid 时返回 { error }
function normalizeClass(value, where) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { className: "" };
  }
  const className = String(value).trim();
  if (!isValidClassAttr(className)) {
    return {
      error:
        `${where}: invalid class ${JSON.stringify(className)} ` +
        `(space-separated tokens, each matching [A-Za-z_-][A-Za-z0-9_-]*).`
    };
  }
  return { className };
}

// toc 字段：undefined/null → null（默认），false → false（不进主目录），
// 字符串 → 覆盖主目录条目文案。true 视为默认。
function normalizeTocOption(value, where) {
  if (value === undefined || value === null || value === true) return { toc: null };
  if (value === false) return { toc: false };
  if (typeof value === "string") {
    const label = value.trim();
    if (!label) return { error: `${where}: "toc" label must not be empty.` };
    return { toc: label };
  }
  return { error: `${where}: "toc" must be false or a label string.` };
}

function normalizePathEntry(entry) {
  const where = `chapter entry ${JSON.stringify(entry.path)}`;
  const extra = unknownKeys(entry, PATH_ENTRY_KEYS);
  if (extra.length > 0) {
    return { error: `${where}: unknown key(s) ${extra.join(", ")} (allowed: path, as, class, chapter_toc, toc).` };
  }

  const file = String(entry.path).trim();
  const defaultKind = classifyChapterPath(file);
  const format = chapterPathFormat(file);
  if (!defaultKind) {
    return {
      error: `unrecognized extension: ${JSON.stringify(file)} (use .md/.markdown or .html/.htm)`
    };
  }

  let kind = defaultKind;
  if (entry.as !== undefined && entry.as !== null) {
    const as = String(entry.as).trim().toLowerCase();
    if (!["chapter", "insert"].includes(as)) {
      return { error: `${where}: "as" must be "chapter" or "insert".` };
    }
    if (as === "chapter" && format === "html") {
      return { error: `${where}: a raw-HTML page cannot be "as: chapter" (write it in Markdown).` };
    }
    kind = as;
  }

  const cls = normalizeClass(entry.class, where);
  if (cls.error) return { error: cls.error };

  let chapterToc = null;
  if (entry.chapter_toc !== undefined && entry.chapter_toc !== null) {
    chapterToc = Boolean(entry.chapter_toc);
  }

  const toc = normalizeTocOption(entry.toc, where);
  if (toc.error) return { error: toc.error };

  return { kind, format, file, className: cls.className, chapterToc, toc: toc.toc };
}

function normalizeDividerEntry(value) {
  const where = "divider entry";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: `${where}: "divider" must be a mapping (title / subtitle / class / ...).` };
  }
  const extra = unknownKeys(value, DIVIDER_KEYS);
  if (extra.length > 0) {
    return {
      error: `${where}: unknown key(s) ${extra.join(", ")} (allowed: ${[...DIVIDER_KEYS].join(", ")}).`
    };
  }

  const text = (v) => (v === undefined || v === null ? "" : String(v));
  const title = text(value.title).trim();
  const subtitle = text(value.subtitle).trim();
  const note = text(value.note).trim();

  const cls = normalizeClass(value.class, where);
  if (cls.error) return { error: cls.error };

  const bleed = Boolean(value.bleed);
  if (bleed && !title) {
    return { error: `${where}: "bleed: true" requires a "title" (it anchors the page lookup).` };
  }
  if (!title && !subtitle && !note && !cls.className) {
    return { error: `${where}: needs at least a title, subtitle, note, or class.` };
  }

  let toc = null;
  if (value.toc !== undefined && value.toc !== null && value.toc !== false) {
    if (typeof value.toc !== "string" || !value.toc.trim()) {
      return { error: `${where}: "toc" must be a label string (or omitted).` };
    }
    toc = value.toc.trim();
  }

  return {
    kind: "divider",
    title,
    subtitle,
    note,
    className: cls.className,
    background: text(value.background).trim(),
    color: text(value.color).trim(),
    bleed,
    toc
  };
}

function normalizeBlankEntry(value) {
  if (value === true) return { kind: "blank", count: 1 };
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20) {
    return { kind: "blank", count: value };
  }
  return { error: `blank entry: use "blank: true" or a page count 1-20 (got ${JSON.stringify(value)}).` };
}

/**
 * Normalize one raw entry (string or mapping) into a descriptor:
 *   path entry   { kind: "chapter"|"insert", format, file, className, chapterToc, toc }
 *   divider      { kind: "divider", title, subtitle, note, className, background, color, bleed, toc }
 *   blank        { kind: "blank", count }
 *   contents     { kind: "contents" }
 * Returns { error } on invalid input.
 */
export function normalizeChapterEntry(entry) {
  if (typeof entry === "string") {
    const file = entry.trim();
    if (!file) return { error: `empty chapter entry` };
    const kind = classifyChapterPath(file);
    if (!kind) {
      return {
        error: `unrecognized extension: ${JSON.stringify(file)} (use .md/.markdown or .html/.htm)`
      };
    }
    return { kind, format: chapterPathFormat(file), file, className: "", chapterToc: null, toc: null };
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const present = TYPE_KEYS.filter((key) => entry[key] !== undefined);
    if (present.length !== 1) {
      return {
        error:
          `chapter entry must have exactly one of ${TYPE_KEYS.map((k) => `"${k}"`).join(" / ")}: ` +
          JSON.stringify(entry)
      };
    }

    if (present[0] === "path") {
      if (entry.path === null || String(entry.path).trim() === "") {
        return { error: `chapter object is missing a "path": ${JSON.stringify(entry)}` };
      }
      return normalizePathEntry(entry);
    }
    if (present[0] === "divider") {
      const extra = unknownKeys(entry, new Set(["divider"]));
      if (extra.length > 0) {
        return { error: `divider entry: move ${extra.join(", ")} inside the "divider:" mapping.` };
      }
      return normalizeDividerEntry(entry.divider);
    }
    if (present[0] === "blank") {
      const extra = unknownKeys(entry, new Set(["blank"]));
      if (extra.length > 0) {
        return { error: `blank entry: unknown key(s) ${extra.join(", ")}.` };
      }
      return normalizeBlankEntry(entry.blank);
    }
    // contents
    const extra = unknownKeys(entry, new Set(["contents"]));
    if (extra.length > 0) {
      return { error: `contents entry: unknown key(s) ${extra.join(", ")}.` };
    }
    if (entry.contents !== true) {
      return { error: `contents entry: use "contents: true".` };
    }
    return { kind: "contents" };
  }

  return { error: `invalid chapter entry: ${JSON.stringify(entry)}` };
}

/**
 * Full normalization used by build.mjs. Throws-free: returns
 *   { entries, source } on success, or { error } (fatal, single message).
 * Per-entry problems are fatal here because the renderer cannot proceed.
 */
export function normalizeChapters(book, baseDir) {
  const resolved = resolveChapterList(book, baseDir);
  if (resolved.error) return { error: resolved.error };
  if (!resolved.list || resolved.list.length === 0) {
    return { error: `"chapters" must not be empty.` };
  }

  const entries = [];
  for (const raw of resolved.list) {
    const d = normalizeChapterEntry(raw);
    if (d.error) return { error: d.error };
    entries.push(d);
  }

  if (!entries.some((e) => e.kind === "chapter" || e.kind === "insert")) {
    return { error: `"chapters" must include at least one .md or .html page.` };
  }
  if (entries.filter((e) => e.kind === "contents").length > 1) {
    return { error: `"chapters" may place the main TOC ("contents: true") at most once.` };
  }

  return { entries, source: resolved.source };
}
