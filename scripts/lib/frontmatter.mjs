// scripts/lib/frontmatter.mjs — 方言无关的 frontmatter 上下文层（v3）。
//
// frontmatter 解析本身与 Obsidian 方言解耦：标准方言同样剥离并解析
// YAML 头（此前它会作为字面 Markdown 泄漏进正文）。方言只决定
// properties 的"展示"（Obsidian 属性表）；本模块负责"语义"：
//   - 规范化派生值（标题/作者/时间/标签……），供 meta band、章节
//     cover 页与 {{fm.*}} 占位符共同使用；
//   - 统一的占位符解析与未知键告警。

import fs from "node:fs";
import { parseObsidianFrontmatter } from "./obsidian.mjs";
import { formatDate } from "./util.mjs";

export { parseObsidianFrontmatter as parseFrontmatter };

// 常用键的别名归一：derived.<规范键> 从这些候选中取第一个存在者
const DERIVED_SOURCES = {
  title: ["title"],
  subtitle: ["subtitle"],
  authors: ["authors", "author"],
  created: ["created", "date"],
  modified: ["modified", "updated"],
  tags: ["tags"],
  status: ["status"]
};

const DATE_LIKE_KEYS = new Set(["created", "modified", "updated", "date"]);

function listItems(value) {
  const items = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  return items.flatMap((item) =>
    typeof item === "string" && item.includes(",")
      ? item.split(",").map((part) => part.trim()).filter(Boolean)
      : [item]
  );
}

function scalarText(value, { dateFormat, dateLike = false } = {}) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return listItems(value)
      .map((item) => scalarText(item, { dateFormat, dateLike }))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    // 日期对象（YAML 时间戳）或其他映射
    if (value instanceof Date) return formatDate(value.toISOString().slice(0, 10), dateFormat);
    return JSON.stringify(value);
  }
  const text = String(value).trim();
  if (dateLike && /^\d{4}-?\d{2}-?\d{2}/.test(text)) return formatDate(text, dateFormat);
  return text;
}

/**
 * 把一章的 frontmatter 数据规范化为渲染上下文：
 *   raw      —— 原始映射（未加工）
 *   values   —— 扁平字符串表：raw 的每个键 + 规范派生键；日期按 dateFormat
 *               格式化，列表以 ", " 连接。供 {{fm.<key>}} 与模板行使用。
 *   derived  —— 结构化派生：{ title, subtitle, authorsList, created,
 *               modified, tagsList, status }
 * options:
 *   dateFormat        —— 日期显示格式（与全局 date_format 一致）
 *   filePath          —— 源文件路径（mtime 回退用）
 *   fallbackModified  —— "file" 时，modified 缺失则取文件 mtime
 */
export function frontmatterContext(data, { dateFormat = "YYYY-MM-DD", filePath = "", fallbackModified = "none" } = {}) {
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const values = {};

  for (const [key, value] of Object.entries(raw)) {
    values[key] = scalarText(value, { dateFormat, dateLike: DATE_LIKE_KEYS.has(key) });
  }

  const pick = (candidates) => {
    for (const key of candidates) {
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return raw[key];
    }
    return undefined;
  };

  const derived = {
    title: scalarText(pick(DERIVED_SOURCES.title), { dateFormat }),
    subtitle: scalarText(pick(DERIVED_SOURCES.subtitle), { dateFormat }),
    authorsList: listItems(pick(DERIVED_SOURCES.authors)).map((item) => scalarText(item, { dateFormat })).filter(Boolean),
    created: scalarText(pick(DERIVED_SOURCES.created), { dateFormat, dateLike: true }),
    modified: scalarText(pick(DERIVED_SOURCES.modified), { dateFormat, dateLike: true }),
    tagsList: listItems(pick(DERIVED_SOURCES.tags))
      .map((item) => scalarText(item, { dateFormat }).replace(/^#/, ""))
      .filter(Boolean),
    status: scalarText(pick(DERIVED_SOURCES.status), { dateFormat })
  };

  if (!derived.modified && fallbackModified === "file" && filePath) {
    try {
      derived.modified = formatDate(
        fs.statSync(filePath).mtime.toISOString().slice(0, 10),
        dateFormat
      );
    } catch {
      // 文件不可读时保持为空
    }
  }

  // 规范派生键进入 values（不覆盖同名原始键的已格式化值）
  for (const [key, value] of Object.entries({
    title: derived.title,
    subtitle: derived.subtitle,
    authors: derived.authorsList.join(", "),
    author: derived.authorsList[0] ?? "",
    created: derived.created,
    modified: derived.modified,
    tags: derived.tagsList.join(", "),
    status: derived.status
  })) {
    if (values[key] === undefined || values[key] === "") values[key] = value;
  }

  return { raw, values, derived };
}

const FM_PLACEHOLDER_RE = /\{\{\s*(?:fm|frontmatter)\.([\w-]+)\s*\}\}/g;

/** 模板里是否出现 {{fm.*}} / {{frontmatter.*}} 占位符。 */
export function hasFmPlaceholders(template) {
  FM_PLACEHOLDER_RE.lastIndex = 0;
  return FM_PLACEHOLDER_RE.test(String(template ?? ""));
}

/**
 * 解析模板中的 {{fm.<key>}}（{{frontmatter.<key>}} 同义）。
 * 其余占位符（{{page}}、{{title}}……）原样保留，交给后续管线。
 * 未知键替换为空串，并通过 warn 回调告警一次。
 */
export function resolveFmPlaceholders(template, values, { warn, source = "" } = {}) {
  return String(template ?? "").replace(FM_PLACEHOLDER_RE, (whole, key) => {
    const value = values?.[key];
    if (value === undefined || value === "") {
      if (value === undefined && warn) {
        warn(`frontmatter key "${key}" is not set${source ? ` in ${source}` : ""}; {{fm.${key}}} renders empty`);
      }
      return value ?? "";
    }
    return value;
  });
}
