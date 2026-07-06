/**
 * scripts/lib/chapters.mjs
 *
 * Shared "chapters" normalization for build.mjs and check.mjs.
 *
 * Design (v1.5): a chapters entry is always a file PATH — never a free label —
 * and its role is decided by the file extension, so a typo can never be
 * silently treated as a "custom page":
 *
 *   .md / .markdown  -> chapter  (rendered from Markdown; the common case,
 *                                 including preface/afterword written in Markdown)
 *   .html / .htm     -> insert   (a trusted raw-HTML page, the escape hatch for
 *                                 layout Markdown cannot express)
 *
 * Two entry shapes:
 *   - string  : just the path (backward compatible)          e.g. notes/00.md
 *   - mapping : { path, class?, chapter_toc? } for the few    e.g. { path: notes/02.md,
 *               entries that need extra per-page options.            chapter_toc: true }
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

/**
 * Normalize one raw entry (string or mapping) into a descriptor:
 *   { kind, file, className, chapterToc }
 *     kind        "chapter" | "insert"
 *     file        the path as written (relative to baseDir)
 *     className   extra CSS class(es) or ""
 *     chapterToc  true | false | null   (null = inherit the global default;
 *                                        only meaningful for chapters)
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
    return { kind, file, className: "", chapterToc: null };
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    if (entry.path === undefined || entry.path === null || String(entry.path).trim() === "") {
      return { error: `chapter object is missing a "path": ${JSON.stringify(entry)}` };
    }
    const file = String(entry.path).trim();
    const kind = classifyChapterPath(file);
    if (!kind) {
      return {
        error: `unrecognized extension: ${JSON.stringify(file)} (use .md/.markdown or .html/.htm)`
      };
    }

    let className = "";
    if (entry.class !== undefined && entry.class !== null) {
      className = String(entry.class).trim();
    }

    let chapterToc = null;
    if (entry.chapter_toc !== undefined && entry.chapter_toc !== null) {
      chapterToc = Boolean(entry.chapter_toc);
    }

    return { kind, file, className, chapterToc };
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
  return { entries, source: resolved.source };
}
