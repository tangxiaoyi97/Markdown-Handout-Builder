// scripts/lib/toc.mjs — 主目录与每章小目录的 HTML 构建（纯函数）。
// .toc-page[data-target] 是页码占位符：屏幕上隐藏；render-pdf.mjs 第一遍
// 打印后解析出真实页码，注入后再打印第二遍。

import { escapeHtml } from "./util.mjs";

// entries: [{ level, id, title }]（文档顺序）
export function buildToc(entries, { enabled = true, title = "目录", depth = 2 } = {}) {
  if (!enabled) return "";
  const items = entries.filter((e) => e.level <= depth);
  if (items.length === 0) return "";

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
    `<h2 class="toc-heading">${escapeHtml(title)}</h2>\n` +
    `${html}\n` +
    "</nav>"
  );
}

// 每章小目录：列出本章 2..depth 级子标题（h1 是章名，不成行）。
// 独立的 .chapter-toc* class（与主 .toc 隔离），但沿用 .toc-page[data-target]
// 钩子，render-pdf 的页码回填免费生效。小目录在正文流内，始终计页。
export function buildChapterToc(headings, { title = "In this chapter", depth = 3, className = "" } = {}) {
  const items = headings.filter((e) => e.level >= 2 && e.level <= depth);
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

  const cls = ["chapter-toc", className].filter(Boolean).join(" ");
  const heading = title
    ? `<p class="chapter-toc-heading">${escapeHtml(title)}</p>\n`
    : "";
  return `<nav class="${cls}">\n${heading}<ul class="chapter-toc-list">\n${rows}\n</ul>\n</nav>`;
}
