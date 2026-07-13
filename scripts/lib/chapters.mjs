/**
 * scripts/lib/chapters.mjs
 *
 * Document-structure normalization shared by build.mjs and check.mjs.
 *
 * Backward compatibility:
 *   chapters: [notes/a.md, ...]
 * remains valid.  The richer spelling is `structure:`; both feed the same
 * flat renderer IR.  A book must use one or the other, never both.
 *
 * New composition primitives:
 *   - explicit `type:` entries (chapter / insert / divider / blank /
 *     contents / part / include)
 *   - named `layouts` with inheritance
 *   - nested parts with inherited defaults
 *   - recursive YAML includes with cycle detection
 *   - orthogonal flow and navigation options
 *
 * The renderer deliberately still consumes a flat sequence.  Parts and
 * includes are expanded here, keeping pagination and Markdown rendering
 * independent from the author-facing configuration language.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MD_EXTS = new Set([".md", ".markdown"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const YAML_EXTS = new Set([".yml", ".yaml"]);
const CLASS_TOKENS_RE = /^[A-Za-z_-][\w-]*(?:\s+[A-Za-z_-][\w-]*)*$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const LEGACY_PATH_KEYS = new Set([
  "path", "as", "role", "class", "layout", "chapter_toc", "toc",
  "navigation", "flow", "running", "meta", "cover"
]);
const LONG_FILE_KEYS = new Set([...LEGACY_PATH_KEYS, "type"]);
const DIVIDER_KEYS = new Set([
  "title", "subtitle", "note", "class", "layout", "background", "color",
  "bleed", "toc", "navigation", "flow", "running"
]);
const LONG_DIVIDER_KEYS = new Set([...DIVIDER_KEYS, "type"]);
const PART_KEYS = new Set([
  ...DIVIDER_KEYS, "defaults", "children", "chapters", "structure"
]);
const LONG_PART_KEYS = new Set([...PART_KEYS, "type"]);
const DEFAULT_KEYS = new Set([
  "class", "layout", "chapter_toc", "toc", "navigation", "flow", "running",
  "meta", "cover"
]);
const LAYOUT_KEYS = new Set([
  "extends", "class", "chapter_toc", "toc", "navigation", "flow", "running",
  "meta", "cover"
]);
const COVER_KEYS = new Set([
  "enabled", "class", "background", "color", "bleed", "title", "subtitle", "meta"
]);
const NAV_KEYS = new Set(["toc", "label", "level", "outline"]);
const FLOW_KEYS = new Set(["break_before", "break_after"]);
const RUNNING_KEYS = new Set(["header", "footer", "style"]);
const RUNNING_SLOT_KEYS = new Set(["left", "center", "right"]);
const RUNNING_STYLE_KEYS = new Set(["font_size", "color", "font_family", "offset"]);
const LEGACY_TYPE_KEYS = ["path", "divider", "blank", "contents", "part", "include"];

export function isValidClassAttr(value) {
  return CLASS_TOKENS_RE.test(String(value).trim());
}

export function classifyChapterPath(value) {
  const ext = path.extname(String(value)).toLowerCase();
  if (MD_EXTS.has(ext)) return "chapter";
  if (HTML_EXTS.has(ext)) return "insert";
  return null;
}

export function chapterPathFormat(value) {
  const ext = path.extname(String(value)).toLowerCase();
  if (MD_EXTS.has(ext)) return "markdown";
  if (HTML_EXTS.has(ext)) return "html";
  return null;
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function cleanClass(value, where) {
  if (value === undefined || value === null || String(value).trim() === "") return { value: "" };
  const className = String(value).trim();
  if (!isValidClassAttr(className)) {
    return {
      error:
        `${where}: invalid class ${JSON.stringify(className)} ` +
        `(space-separated tokens, each matching [A-Za-z_-][A-Za-z0-9_-]*).`
    };
  }
  return { value: className };
}

function joinClasses(...values) {
  return [...new Set(values.flatMap((value) => String(value ?? "").trim().split(/\s+/)).filter(Boolean))]
    .join(" ");
}

function normalizeFlow(value, where, { partial = false } = {}) {
  if (value === undefined || value === null) return partial ? {} : { breakBefore: "page", breakAfter: "auto" };
  if (!isMapping(value)) return { error: `${where}.flow must be a mapping.` };
  const extra = unknownKeys(value, FLOW_KEYS);
  if (extra.length) return { error: `${where}.flow: unknown key(s) ${extra.join(", ")}.` };

  const out = {};
  for (const [rawKey, key] of [["break_before", "breakBefore"], ["break_after", "breakAfter"]]) {
    if (value[rawKey] === undefined || value[rawKey] === null) continue;
    const choice = String(value[rawKey]).trim().toLowerCase();
    if (!["auto", "page"].includes(choice)) {
      return { error: `${where}.flow.${rawKey} must be "auto" or "page".` };
    }
    out[key] = choice;
  }
  if (!partial) {
    out.breakBefore ??= "page";
    out.breakAfter ??= "auto";
  }
  return out;
}

function normalizeNavigation(value, where, { partial = false, legacyToc } = {}) {
  if (value !== undefined && value !== null && !isMapping(value)) {
    return { error: `${where}.navigation must be a mapping.` };
  }
  const nav = value ?? {};
  const extra = unknownKeys(nav, NAV_KEYS);
  if (extra.length) return { error: `${where}.navigation: unknown key(s) ${extra.join(", ")}.` };

  const out = {};
  let tocValue = nav.toc;
  if (tocValue === undefined) tocValue = legacyToc;
  if (tocValue !== undefined && tocValue !== null) {
    if (typeof tocValue === "boolean") out.toc = tocValue;
    else if (typeof tocValue === "string" && tocValue.trim()) {
      out.toc = true;
      out.label = tocValue.trim();
    } else {
      return { error: `${where}: "toc" must be true, false, or a non-empty label string.` };
    }
  }
  if (nav.label !== undefined && nav.label !== null) {
    if (typeof nav.label !== "string" || !nav.label.trim()) {
      return { error: `${where}.navigation.label must be a non-empty string.` };
    }
    out.label = nav.label.trim();
    out.toc ??= true;
  }
  if (nav.level !== undefined && nav.level !== null) {
    if (!Number.isInteger(nav.level) || nav.level < 1 || nav.level > 6) {
      return { error: `${where}.navigation.level must be an integer between 1 and 6.` };
    }
    out.level = nav.level;
  }
  if (nav.outline !== undefined && typeof nav.outline !== "boolean") {
    return { error: `${where}.navigation.outline must be true or false.` };
  }
  if (typeof nav.outline === "boolean") out.outline = nav.outline;

  if (!partial) {
    out.toc ??= true;
    out.outline ??= true;
    out.level ??= 1;
  }
  if (!partial && out.outline === false && out.toc !== false) {
    return {
      error:
        `${where}: navigation.outline: false currently requires navigation.toc: false ` +
        `(TOC page-number mapping uses PDF outline destinations).`
    };
  }
  return out;
}

function normalizeRunning(value, where, { partial = false } = {}) {
  if (value === undefined || value === null) {
    return partial
      ? {}
      : {
          header: true,
          footer: true,
          style: {},
          headerSet: false,
          footerSet: false,
          styleSet: false,
          custom: false
        };
  }
  if (value === false) {
    return {
      header: false,
      footer: false,
      style: {},
      headerSet: true,
      footerSet: true,
      styleSet: false,
      custom: true
    };
  }
  if (!isMapping(value)) {
    return { error: `${where}.running must be false or a header/footer/style mapping.` };
  }
  const extra = unknownKeys(value, RUNNING_KEYS);
  if (extra.length) return { error: `${where}.running: unknown key(s) ${extra.join(", ")}.` };

  const out = {
    style: {},
    headerSet: Object.hasOwn(value, "header"),
    footerSet: Object.hasOwn(value, "footer"),
    styleSet: Object.hasOwn(value, "style"),
    custom: Object.keys(value).length > 0
  };
  for (const key of ["header", "footer"]) {
    const band = value[key];
    if (band === undefined) continue;
    if (typeof band === "boolean") {
      out[key] = band;
      continue;
    }
    if (!isMapping(band)) {
      return {
        error:
          `${where}.running.${key} must be true, false, or a left/center/right mapping.`
      };
    }
    const bandExtra = unknownKeys(band, RUNNING_SLOT_KEYS);
    if (bandExtra.length) {
      return {
        error: `${where}.running.${key}: unknown slot(s) ${bandExtra.join(", ")}.`
      };
    }
    const slots = {};
    for (const [slot, content] of Object.entries(band)) {
      if (typeof content !== "string") {
        return { error: `${where}.running.${key}.${slot} must be a string.` };
      }
      slots[slot] = content;
    }
    out[key] = slots;
  }

  if (value.style !== undefined) {
    if (!isMapping(value.style)) {
      return { error: `${where}.running.style must be a mapping.` };
    }
    const styleExtra = unknownKeys(value.style, RUNNING_STYLE_KEYS);
    if (styleExtra.length) {
      return {
        error: `${where}.running.style: unknown key(s) ${styleExtra.join(", ")}.`
      };
    }
    for (const [key, setting] of Object.entries(value.style)) {
      if (typeof setting !== "string" || !setting.trim()) {
        return { error: `${where}.running.style.${key} must be a non-empty string.` };
      }
      out.style[key] = setting.trim();
    }
  }

  if (!partial) {
    out.header ??= true;
    out.footer ??= true;
  }
  out.styleSet = Object.keys(out.style).length > 0;
  out.custom = Boolean(out.headerSet || out.footerSet || out.styleSet);
  return out;
}

function mergeRunning(base = {}, override = {}) {
  const mergeBand = (left, right) => {
    if (right === undefined) return left;
    if (isMapping(left) && isMapping(right)) return { ...left, ...right };
    return right;
  };
  return {
    header: mergeBand(base.header, override.header),
    footer: mergeBand(base.footer, override.footer),
    style: { ...(base.style ?? {}), ...(override.style ?? {}) },
    headerSet: Boolean(base.headerSet || override.headerSet),
    footerSet: Boolean(base.footerSet || override.footerSet),
    styleSet: Boolean(base.styleSet || override.styleSet),
    custom: Boolean(base.custom || override.custom)
  };
}

// meta（章标题下的 frontmatter byline）：false 关闭；字符串列表指定键序；
// 缺省 = 继承（全局 frontmatter.meta 或上层默认）。
function normalizeMeta(value, where) {
  if (value === undefined || value === null) return { value: undefined };
  if (value === false) return { value: false };
  if (Array.isArray(value)) {
    const keys = value.map((item) => String(item ?? "").trim());
    if (keys.some((item) => !item)) {
      return { error: `${where}.meta entries must be non-empty frontmatter keys.` };
    }
    return { value: keys };
  }
  return { error: `${where}.meta must be false or a list of frontmatter keys.` };
}

// cover（章节前页）：true 全默认；false 显式关闭（覆盖继承）；映射逐键配置。
function normalizeCover(value, where) {
  if (value === undefined || value === null) return { value: undefined };
  if (value === true) return { value: { set: true, enabled: true } };
  if (value === false) return { value: { set: true, enabled: false } };
  if (!isMapping(value)) {
    return { error: `${where}.cover must be true, false, or a mapping.` };
  }
  const extra = unknownKeys(value, COVER_KEYS);
  if (extra.length) return { error: `${where}.cover: unknown key(s) ${extra.join(", ")}.` };
  const cls = cleanClass(value.class, `${where}.cover`);
  if (cls.error) return cls;
  const text = (item) => (item === undefined || item === null ? undefined : String(item).trim());
  let metaLines;
  if (value.meta !== undefined && value.meta !== null) {
    if (!Array.isArray(value.meta) || value.meta.some((line) => typeof line !== "string" || !line.trim())) {
      return { error: `${where}.cover.meta must be a list of non-empty template strings.` };
    }
    metaLines = value.meta.map((line) => line.trim());
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return { error: `${where}.cover.enabled must be true or false.` };
  }
  if (value.bleed !== undefined && typeof value.bleed !== "boolean") {
    return { error: `${where}.cover.bleed must be true or false.` };
  }
  return {
    value: {
      set: true,
      enabled: value.enabled ?? true,
      className: cls.value || undefined,
      background: text(value.background),
      color: text(value.color),
      bleed: value.bleed,
      title: text(value.title),
      subtitle: text(value.subtitle),
      metaLines
    }
  };
}

function mergeCover(base, override) {
  if (override === undefined) return base;
  if (base === undefined || override.enabled === false) return override;
  return {
    set: true,
    enabled: override.enabled ?? base.enabled ?? true,
    className: joinClasses(base.className, override.className) || undefined,
    background: override.background ?? base.background,
    color: override.color ?? base.color,
    bleed: override.bleed ?? base.bleed,
    title: override.title ?? base.title,
    subtitle: override.subtitle ?? base.subtitle,
    metaLines: override.metaLines ?? base.metaLines
  };
}

function normalizeDefaults(value, where) {
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) return { error: `${where} must be a mapping.` };
  const extra = unknownKeys(value, DEFAULT_KEYS);
  if (extra.length) return { error: `${where}: unknown key(s) ${extra.join(", ")}.` };
  const cls = cleanClass(value.class, where);
  if (cls.error) return cls;
  const flow = normalizeFlow(value.flow, where, { partial: true });
  if (flow.error) return flow;
  const navigation = normalizeNavigation(value.navigation, where, {
    partial: true,
    legacyToc: value.toc
  });
  if (navigation.error) return navigation;
  const running = normalizeRunning(value.running, where, { partial: true });
  if (running.error) return running;
  const meta = normalizeMeta(value.meta, where);
  if (meta.error) return meta;
  const cover = normalizeCover(value.cover, where);
  if (cover.error) return cover;
  if (value.chapter_toc !== undefined && typeof value.chapter_toc !== "boolean") {
    return { error: `${where}.chapter_toc must be true or false.` };
  }
  if (value.layout !== undefined && (typeof value.layout !== "string" || !value.layout.trim())) {
    return { error: `${where}.layout must be a non-empty layout name.` };
  }
  return {
    className: cls.value,
    layout: value.layout?.trim(),
    chapterToc: value.chapter_toc,
    flow,
    navigation,
    running,
    meta: meta.value,
    cover: cover.value
  };
}

function mergeOptions(...values) {
  const out = {
    className: "",
    layout: undefined,
    chapterToc: undefined,
    flow: {},
    navigation: {},
    running: {},
    meta: undefined,
    cover: undefined
  };
  for (const value of values.filter(Boolean)) {
    out.className = joinClasses(out.className, value.className);
    if (value.layout !== undefined) out.layout = value.layout;
    if (value.chapterToc !== undefined) out.chapterToc = value.chapterToc;
    out.flow = { ...out.flow, ...(value.flow ?? {}) };
    out.navigation = { ...out.navigation, ...(value.navigation ?? {}) };
    out.running = mergeRunning(out.running, value.running);
    if (value.meta !== undefined) out.meta = value.meta;
    out.cover = mergeCover(out.cover, value.cover);
  }
  return out;
}

function resolveLayouts(raw) {
  if (raw === undefined || raw === null) return { layouts: new Map(), errors: [] };
  if (!isMapping(raw)) return { layouts: new Map(), errors: ['"layouts" must be a mapping.'] };

  const definitions = new Map();
  const errors = [];
  for (const [name, value] of Object.entries(raw)) {
    const where = `layouts.${name}`;
    if (!NAME_RE.test(name)) {
      errors.push(`${where}: layout names must match [A-Za-z_][A-Za-z0-9_-]*.`);
      continue;
    }
    if (!isMapping(value)) {
      errors.push(`${where} must be a mapping.`);
      continue;
    }
    const extra = unknownKeys(value, LAYOUT_KEYS);
    if (extra.length) {
      errors.push(`${where}: unknown key(s) ${extra.join(", ")}.`);
      continue;
    }
    const normalized = normalizeDefaults(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "extends")),
      where
    );
    if (normalized.error) {
      errors.push(normalized.error);
      continue;
    }
    if (value.extends !== undefined && (typeof value.extends !== "string" || !value.extends.trim())) {
      errors.push(`${where}.extends must be a non-empty layout name.`);
      continue;
    }
    definitions.set(name, { ...normalized, extends: value.extends?.trim() });
  }

  const layouts = new Map();
  const resolving = [];
  function visit(name) {
    if (layouts.has(name)) return layouts.get(name);
    const definition = definitions.get(name);
    if (!definition) return null;
    if (resolving.includes(name)) {
      errors.push(`layout inheritance cycle: ${[...resolving, name].join(" -> ")}`);
      return null;
    }
    resolving.push(name);
    let parent = null;
    if (definition.extends) {
      parent = visit(definition.extends);
      if (!definitions.has(definition.extends)) {
        errors.push(`layouts.${name}.extends references unknown layout ${JSON.stringify(definition.extends)}.`);
      }
    }
    resolving.pop();
    const merged = mergeOptions(parent, definition);
    layouts.set(name, merged);
    return merged;
  }
  for (const name of definitions.keys()) visit(name);
  return { layouts, errors };
}

function parseYamlList(filePath, acceptedKeys) {
  let document;
  try {
    document = YAML.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { error: `failed to parse structure file ${filePath}: ${error.message}` };
  }
  if (Array.isArray(document)) return { list: document };
  if (isMapping(document)) {
    for (const key of acceptedKeys) {
      if (Array.isArray(document[key])) return { list: document[key] };
    }
  }
  return { error: `structure file ${filePath} must be a YAML list (or a mapping with a structure/chapters list).` };
}

/** Resolve the root list. Exported under the old name for API compatibility. */
export function resolveChapterList(book, baseDir) {
  const hasStructure = book?.structure !== undefined;
  const hasChapters = book?.chapters !== undefined;
  if (hasStructure && hasChapters) {
    return { error: 'use either "structure" or "chapters", not both.' };
  }
  const key = hasStructure ? "structure" : "chapters";
  const raw = book?.[key];
  if (typeof raw === "string") {
    const ref = raw.trim();
    if (!YAML_EXTS.has(path.extname(ref).toLowerCase())) {
      return { error: `"${key}" as a string must point to a .yml/.yaml file.` };
    }
    const filePath = path.resolve(baseDir, ref);
    if (!fs.existsSync(filePath)) return { error: `${key} file not found: ${ref}` };
    const parsed = parseYamlList(filePath, [key, "structure", "chapters"]);
    return parsed.error ? parsed : { list: parsed.list, source: ref, sourcePath: filePath, key };
  }
  if (Array.isArray(raw)) return { list: raw, source: null, sourcePath: null, key };
  return { error: `"${key}" must be a non-empty list, or a path to a .yml/.yaml structure file.` };
}

function optionsFromRaw(raw, where, inherited, layouts) {
  const own = normalizeDefaults(
    Object.fromEntries(Object.entries(raw).filter(([key]) => DEFAULT_KEYS.has(key))),
    where
  );
  if (own.error) return own;
  const requestedLayout = own.layout ?? inherited.layout;
  let layout = null;
  if (requestedLayout) {
    layout = layouts.get(requestedLayout);
    if (!layout) return { error: `${where}.layout references unknown layout ${JSON.stringify(requestedLayout)}.` };
  }
  const options = mergeOptions(layout, inherited, own);
  options.layout = requestedLayout;
  options.flow = { breakBefore: "page", breakAfter: "auto", ...options.flow };
  options.navigation = { toc: true, outline: true, level: 1, ...options.navigation };
  options.running = {
    header: options.running.header ?? true,
    footer: options.running.footer ?? true,
    style: options.running.style ?? {},
    headerSet: Boolean(options.running.headerSet),
    footerSet: Boolean(options.running.footerSet),
    styleSet: Boolean(options.running.styleSet),
    custom: Boolean(options.running.custom)
  };
  if (options.navigation.outline === false && options.navigation.toc !== false) {
    return {
      error:
        `${where}: navigation.outline: false currently requires navigation.toc: false ` +
        `(TOC page-number mapping uses PDF outline destinations).`
    };
  }
  if (
    options.running.custom &&
    options.flow.breakBefore === "auto"
  ) {
    return {
      error:
        `${where}: a per-entry running header/footer policy requires flow.break_before: page ` +
        `(a shared physical page cannot have two running profiles).`
    };
  }
  options.chapterToc = options.chapterToc ?? null;
  return options;
}

function normalizePathEntry(raw, where, inherited, layouts, explicitType = null) {
  const extra = unknownKeys(raw, explicitType ? LONG_FILE_KEYS : LEGACY_PATH_KEYS);
  if (extra.length) return { error: `${where}: unknown key(s) ${extra.join(", ")}.` };
  if (raw.path === undefined || raw.path === null || !String(raw.path).trim()) {
    return { error: `${where}: missing a non-empty path.` };
  }
  const file = String(raw.path).trim();
  const format = chapterPathFormat(file);
  const defaultKind = classifyChapterPath(file);
  if (!format) return { error: `${where}: unrecognized extension ${JSON.stringify(file)} (use Markdown or HTML).` };

  if (raw.role !== undefined && raw.as !== undefined) {
    return { error: `${where}: use either "role" or its legacy alias "as", not both.` };
  }

  let kind = explicitType ?? defaultKind;
  const role = raw.role ?? raw.as;
  if (role !== undefined && role !== null) {
    const requested = String(role).trim().toLowerCase();
    if (explicitType && requested !== explicitType) {
      return { error: `${where}: explicit type ${JSON.stringify(explicitType)} conflicts with role/as ${JSON.stringify(requested)}.` };
    }
    kind = requested;
  }
  if (!["chapter", "insert"].includes(kind)) return { error: `${where}: role/as must be "chapter" or "insert".` };
  if (kind === "chapter" && format === "html") {
    return { error: `${where}: a raw-HTML page cannot be "as: chapter" (write it in Markdown).` };
  }

  const options = optionsFromRaw(raw, where, inherited, layouts);
  if (options.error) return options;
  const cover = options.cover?.set && options.cover.enabled !== false ? options.cover : null;
  if (cover && format === "html") {
    return { error: `${where}: a chapter cover page requires a Markdown page (raw-HTML inserts have no frontmatter).` };
  }
  if (cover && kind !== "chapter") {
    return { error: `${where}: a chapter cover page applies to chapters only.` };
  }
  if (cover?.bleed && options.navigation.outline === false) {
    return { error: `${where}: cover.bleed requires navigation.outline: true (page lookup uses the chapter heading).` };
  }
  return {
    kind,
    role: kind,
    format,
    file,
    className: options.className,
    layout: options.layout ?? "",
    chapterToc: options.chapterToc,
    toc: options.navigation.toc === false ? false : (options.navigation.label ?? null),
    navigation: options.navigation,
    flow: options.flow,
    running: options.running,
    meta: options.meta,
    cover
  };
}

function dividerFromValue(value, where, inherited, layouts, { defaultToc = false } = {}) {
  if (!isMapping(value)) return { error: `${where} must be a mapping.` };
  const extra = unknownKeys(value, DIVIDER_KEYS);
  if (extra.length) return { error: `${where}: unknown key(s) ${extra.join(", ")}.` };
  const options = optionsFromRaw(value, where, inherited, layouts);
  if (options.error) return options;
  if (value.toc === undefined && value.navigation === undefined) {
    options.navigation.toc = defaultToc;
  }
  const text = (item) => item === undefined || item === null ? "" : String(item).trim();
  const title = text(value.title);
  const subtitle = text(value.subtitle);
  const note = text(value.note);
  if (value.bleed === true && !title) return { error: `${where}: bleed: true requires a "title".` };
  if (!title && !subtitle && !note && !options.className) {
    return { error: `${where}: needs at least a title, subtitle, note, or class.` };
  }
  return {
    kind: "divider",
    role: "part",
    title,
    subtitle,
    note,
    className: options.className,
    layout: options.layout ?? "",
    background: text(value.background),
    color: text(value.color),
    bleed: value.bleed === true,
    toc: options.navigation.toc === false ? null : (options.navigation.label ?? title ?? null),
    navigation: options.navigation,
    flow: options.flow,
    running: options.running
  };
}

function normalizeBlankCount(value, where) {
  if (value === true) return 1;
  if (Number.isInteger(value) && value >= 1 && value <= 20) return value;
  return { error: `${where}: use true or a page count from 1 to 20.` };
}

function longEntryToLegacy(raw, where) {
  const type = String(raw.type ?? "").trim().toLowerCase();
  if (!type) return { error: `${where}.type must be a non-empty string.` };
  if (["chapter", "insert"].includes(type)) return { kind: "path", explicitType: type };
  if (["divider", "blank", "contents", "part", "include"].includes(type)) return { kind: type };
  return { error: `${where}.type is unknown: ${JSON.stringify(type)}.` };
}

/**
 * Legacy single-entry normalizer. New structure features need book-level
 * layouts/includes, so callers should prefer normalizeChapters().
 */
export function normalizeChapterEntry(entry) {
  const layouts = new Map();
  const inherited = { className: "", flow: {}, navigation: {} };
  if (typeof entry === "string") return normalizePathEntry({ path: entry }, "chapter entry", inherited, layouts);
  if (!isMapping(entry)) return { error: `invalid chapter entry: ${JSON.stringify(entry)}` };
  if (entry.type !== undefined) {
    const typed = longEntryToLegacy(entry, "structure entry");
    if (typed.error) return typed;
    if (typed.kind === "path") return normalizePathEntry(entry, "structure entry", inherited, layouts, typed.explicitType);
    if (typed.kind === "divider") {
      const extra = unknownKeys(entry, LONG_DIVIDER_KEYS);
      if (extra.length) return { error: `structure divider: unknown key(s) ${extra.join(", ")}.` };
      const { type: _type, ...value } = entry;
      return dividerFromValue(value, "structure divider", inherited, layouts);
    }
    if (typed.kind === "blank") {
      const count = normalizeBlankCount(entry.count ?? true, "blank entry");
      return count.error ? count : { kind: "blank", role: "blank", count, className: "", layout: "", flow: { breakBefore: "page", breakAfter: "auto" } };
    }
    if (typed.kind === "contents") return { kind: "contents", role: "contents" };
    return { error: `${typed.kind} entries require book-level normalization.` };
  }
  const present = LEGACY_TYPE_KEYS.filter((key) => entry[key] !== undefined);
  if (present.length !== 1) {
    return { error: `chapter entry must have exactly one of ${LEGACY_TYPE_KEYS.map((key) => `"${key}"`).join(" / ")}: ${JSON.stringify(entry)}` };
  }
  if (present[0] === "path") return normalizePathEntry(entry, "chapter entry", inherited, layouts);
  if (present[0] === "divider") return dividerFromValue(entry.divider, "divider entry", inherited, layouts);
  if (present[0] === "blank") {
    const count = normalizeBlankCount(entry.blank, "blank entry");
    return count.error ? count : { kind: "blank", count };
  }
  if (present[0] === "contents") {
    if (entry.contents !== true) return { error: `contents entry: use "contents: true".` };
    return { kind: "contents", role: "contents" };
  }
  return { error: `${present[0]} entries require book-level normalization.` };
}

/** Full book/structure normalization. Returns all errors so `check` can report them together. */
export function normalizeChapters(book, baseDir) {
  const root = resolveChapterList(book, baseDir);
  if (root.error) return { entries: [], errors: [root.error], error: root.error };
  const layoutResult = resolveLayouts(book.layouts);
  const errors = [...layoutResult.errors];
  const entries = [];
  const includeStack = [];
  const dependencies = new Set(root.sourcePath ? [root.sourcePath] : []);
  let contentsCount = 0;

  function addEntry(raw, inherited = { className: "", flow: {}, navigation: {} }, context = {}) {
    const where = context.where ?? "structure entry";
    if (typeof raw === "string") {
      const normalized = normalizePathEntry({ path: raw }, where, inherited, layoutResult.layouts);
      if (normalized.error) errors.push(normalized.error);
      else entries.push(normalized);
      return;
    }
    if (!isMapping(raw)) {
      errors.push(`${where}: invalid entry ${JSON.stringify(raw)}.`);
      return;
    }

    let kind;
    let explicitType = null;
    if (raw.type !== undefined) {
      const typed = longEntryToLegacy(raw, where);
      if (typed.error) {
        errors.push(typed.error);
        return;
      }
      kind = typed.kind;
      explicitType = typed.explicitType ?? null;
    } else {
      const present = LEGACY_TYPE_KEYS.filter((key) => raw[key] !== undefined);
      if (present.length !== 1) {
        errors.push(
          `${where}: entry must have exactly one of ` +
            `"path" / "divider" / "blank" / "contents" / "part" / "include", ` +
            `or an explicit "type".`
        );
        return;
      }
      kind = present[0];
    }

    if (kind === "path") {
      const normalized = normalizePathEntry(raw, where, inherited, layoutResult.layouts, explicitType);
      if (normalized.error) errors.push(normalized.error);
      else entries.push(normalized);
      return;
    }

    if (kind === "divider") {
      let value = raw.divider;
      if (raw.type !== undefined) {
        const extra = unknownKeys(raw, LONG_DIVIDER_KEYS);
        if (extra.length) {
          errors.push(`${where}: unknown key(s) ${extra.join(", ")}.`);
          return;
        }
        const { type: _type, ...rest } = raw;
        value = rest;
      } else if (unknownKeys(raw, new Set(["divider"])).length) {
        errors.push(`${where}: divider options belong inside the "divider" mapping.`);
        return;
      }
      const normalized = dividerFromValue(value, where, inherited, layoutResult.layouts);
      if (normalized.error) errors.push(normalized.error);
      else entries.push(normalized);
      return;
    }

    if (kind === "blank") {
      const value = raw.type !== undefined ? (raw.count ?? true) : raw.blank;
      const allowed = raw.type !== undefined
        ? new Set(["type", "count", "class", "layout", "flow"])
        : new Set(["blank"]);
      const extra = unknownKeys(raw, allowed);
      if (extra.length) {
        errors.push(`${where}: blank entry has unknown key(s) ${extra.join(", ")}.`);
        return;
      }
      const count = normalizeBlankCount(value, where);
      if (count.error) {
        errors.push(count.error);
        return;
      }
      const options = optionsFromRaw(
        raw.type !== undefined ? raw : {},
        where,
        inherited,
        layoutResult.layouts
      );
      if (options.error) errors.push(options.error);
      else if (options.running.custom) {
        errors.push(
          `${where}: blank pages cannot inherit a per-entry running policy; ` +
            "place the policy on an outline-addressable chapter or divider"
        );
      } else {
        entries.push({
          kind: "blank",
          role: "blank",
          count,
          className: options.className,
          layout: options.layout ?? "",
          flow: options.flow,
          running: options.running
        });
      }
      return;
    }

    if (kind === "contents") {
      const allowed = raw.type !== undefined ? new Set(["type"]) : new Set(["contents"]);
      const extra = unknownKeys(raw, allowed);
      if (extra.length || (raw.type === undefined && raw.contents !== true)) {
        errors.push(`${where}: contents entry accepts no options; use contents: true or type: contents.`);
        return;
      }
      contentsCount += 1;
      entries.push({ kind: "contents", role: "contents" });
      return;
    }

    if (kind === "include") {
      const allowed = raw.type !== undefined ? new Set(["type", "path"]) : new Set(["include"]);
      const extra = unknownKeys(raw, allowed);
      if (extra.length) {
        errors.push(`${where}: include entry has unknown key(s) ${extra.join(", ")}.`);
        return;
      }
      const ref = String(raw.type !== undefined ? raw.path ?? "" : raw.include ?? "").trim();
      if (!ref || !YAML_EXTS.has(path.extname(ref).toLowerCase())) {
        errors.push(`${where}: include must reference a .yml/.yaml file.`);
        return;
      }
      const includeBase = context.sourceDir ?? baseDir;
      const abs = path.resolve(includeBase, ref);
      if (!fs.existsSync(abs)) {
        errors.push(`${where}: include file not found: ${ref}`);
        return;
      }
      dependencies.add(abs);
      if (includeStack.includes(abs)) {
        errors.push(`structure include cycle: ${[...includeStack, abs].map((p) => path.relative(baseDir, p)).join(" -> ")}`);
        return;
      }
      const parsed = parseYamlList(abs, ["structure", "chapters"]);
      if (parsed.error) {
        errors.push(parsed.error);
        return;
      }
      includeStack.push(abs);
      parsed.list.forEach((child, index) => addEntry(child, inherited, {
        where: `${path.relative(baseDir, abs)}[${index}]`,
        sourceDir: path.dirname(abs)
      }));
      includeStack.pop();
      return;
    }

    // part: render a semantic divider, then flatten its children. Defaults are
    // inherited by descendants; the part's TOC level becomes their base level.
    let value = raw.part;
    if (raw.type !== undefined) {
      const extra = unknownKeys(raw, LONG_PART_KEYS);
      if (extra.length) {
        errors.push(`${where}: part entry has unknown key(s) ${extra.join(", ")}.`);
        return;
      }
      const { type: _type, ...rest } = raw;
      value = rest;
    } else if (unknownKeys(raw, new Set(["part"])).length) {
      errors.push(`${where}: part options belong inside the "part" mapping.`);
      return;
    }
    if (!isMapping(value)) {
      errors.push(`${where}: part must be a mapping.`);
      return;
    }
    const extra = unknownKeys(value, PART_KEYS);
    if (extra.length) {
      errors.push(`${where}: part has unknown key(s) ${extra.join(", ")}.`);
      return;
    }
    const children = value.children ?? value.chapters ?? value.structure;
    const childKeys = ["children", "chapters", "structure"].filter(
      (key) => value[key] !== undefined
    );
    if (childKeys.length !== 1) {
      errors.push(
        `${where}: part must use exactly one of children / chapters / structure ` +
          `(found ${childKeys.length ? childKeys.join(", ") : "none"}).`
      );
      return;
    }
    if (!Array.isArray(children) || children.length === 0) {
      errors.push(`${where}: part needs a non-empty children/chapters list.`);
      return;
    }
    const dividerValue = Object.fromEntries(Object.entries(value).filter(([key]) => DIVIDER_KEYS.has(key)));
    const part = dividerFromValue(
      dividerValue,
      where,
      inherited,
      layoutResult.layouts,
      { defaultToc: true }
    );
    if (part.error) {
      errors.push(part.error);
      return;
    }
    part.role = "part";
    entries.push(part);
    const defaults = normalizeDefaults(value.defaults, `${where}.defaults`);
    if (defaults.error) {
      errors.push(defaults.error);
      return;
    }
    const inheritedLevel = part.navigation.level ?? 1;
    const childDefaults = mergeOptions(inherited, defaults, {
      navigation: defaults.navigation?.level === undefined ? { level: Math.min(6, inheritedLevel + 1) } : {}
    });
    children.forEach((child, index) => addEntry(child, childDefaults, {
      where: `${where}.children[${index}]`,
      sourceDir: context.sourceDir
    }));
  }

  if (!root.list.length) errors.push(`"${root.key}" must not be empty.`);
  const rootSourceDir = root.sourcePath ? path.dirname(root.sourcePath) : baseDir;
  if (root.sourcePath) includeStack.push(root.sourcePath);
  root.list.forEach((entry, index) => addEntry(entry, undefined, {
    where: `${root.key}[${index}]`,
    sourceDir: rootSourceDir
  }));
  if (root.sourcePath) includeStack.pop();

  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (
      current.running?.custom &&
      current.flow?.breakAfter !== "page" &&
      next.flow?.breakBefore === "auto"
    ) {
      const currentLabel = current.file ?? current.title ?? current.kind;
      const nextLabel = next.file ?? next.title ?? next.kind;
      errors.push(
        `running profile on ${JSON.stringify(currentLabel)} cannot share a physical page ` +
          `with following entry ${JSON.stringify(nextLabel)}; use flow.break_after: page ` +
          `or make the following entry use flow.break_before: page.`
      );
    }
  }

  if (contentsCount > 1) errors.push(`"contents: true" may appear at most once in document structure.`);
  if (!entries.some((entry) => entry.kind === "chapter" || entry.kind === "insert")) {
    errors.push(`document structure must include at least one .md or .html file page.`);
  }
  const error = errors[0];
  return {
    entries,
    source: root.source,
    key: root.key,
    layouts: layoutResult.layouts,
    dependencies: [...dependencies],
    errors,
    error
  };
}
