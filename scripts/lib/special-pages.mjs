// scripts/lib/special-pages.mjs — 声明式特殊页（divider / blank / contents 槽位）。
// divider 的 title 渲染为真实 <h1>：它同时供 PDF 书签、主目录页码回填
// 与出血覆盖的物理页定位使用（同一套 outline 映射机制）。

import { escapeHtml, sanitizeCssValue } from "./util.mjs";

// contents: true 条目在正文流中的占位符；主目录构建完成后原地替换
export const CONTENTS_SLOT_MARKER = "<!--MHB_CONTENTS_SLOT-->";

// 篇章隔页。恰占一页由 print.css 的 .hb-divider 规则保证（封底同款
// min-height 模式）；bleed 时 data-hb-bleed 指向标题 id，官方 PDF 管线
// 据此做独立单页打印并整页覆盖。
export function dividerSectionHtml(entry, { headingId, lead = "" }) {
  const styleParts = [];
  if (entry.background) styleParts.push(`background: ${sanitizeCssValue(entry.background)};`);
  if (entry.color) styleParts.push(`color: ${sanitizeCssValue(entry.color)};`);
  const styleAttr = styleParts.length > 0 ? ` style="${escapeHtml(styleParts.join(" "))}"` : "";
  const bleedAttr = entry.bleed ? ` data-hb-bleed="${headingId}"` : "";
  const cls = ["insert", "hb-divider", entry.className, lead].filter(Boolean).join(" ");
  const layoutAttr = entry.layout ? ` data-layout="${escapeHtml(entry.layout)}"` : "";
  const anchorAttr = entry.anchorId ? ` data-hb-anchor="${escapeHtml(entry.anchorId)}"` : "";
  const headerAttr = entry.running?.header === false ? ' data-hb-running-header="false"' : "";
  const footerAttr = entry.running?.footer === false ? ' data-hb-running-footer="false"' : "";
  const runningAttr = entry.running?.custom
    ? ` data-hb-running="${escapeHtml(JSON.stringify({
        header: entry.running.header,
        footer: entry.running.footer,
        style: entry.running.style ?? {},
        headerSet: Boolean(entry.running.headerSet),
        footerSet: Boolean(entry.running.footerSet),
        styleSet: Boolean(entry.running.styleSet)
      }))}"`
    : "";

  const lines = [];
  if (entry.title) {
    lines.push(
      `<h1 class="hb-divider-title" id="${headingId}" tabindex="-1">${escapeHtml(entry.title)}</h1>`
    );
  }
  if (entry.subtitle) lines.push(`<p class="hb-divider-subtitle">${escapeHtml(entry.subtitle)}</p>`);
  if (entry.note) lines.push(`<p class="hb-divider-note">${escapeHtml(entry.note)}</p>`);

  return (
    `<section class="${cls}" id="${headingId}-sec"${bleedAttr}${layoutAttr}${anchorAttr}${headerAttr}${footerAttr}${runningAttr}${styleAttr}>\n` +
    `<div class="hb-divider-inner">\n${lines.join("\n")}\n</div>\n` +
    "</section>"
  );
}

// 占位空白页：占据整整一页（双面印刷的对页排版）。不带运行页眉。
export function blankSectionHtml(entry = {}) {
  const cls = ["insert", "hb-blank", entry.className].filter(Boolean).join(" ");
  const layoutAttr = entry.layout ? ` data-layout="${escapeHtml(entry.layout)}"` : "";
  return `<section class="${cls}"${layoutAttr} aria-hidden="true"></section>`;
}

// ---- v3：frontmatter 驱动的章节元素 ----

// 章标题下的 byline（frontmatter meta band）。keys 决定顺序；空值跳过。
// tags 渲染为胶囊；authors 取拼接串；其余键有 label 则带标签前缀。
export function chapterMetaHtml(keys, fm, { labels = {} } = {}) {
  const items = [];
  for (const key of keys) {
    if (key === "tags") {
      for (const tag of fm.derived.tagsList) {
        items.push(`<span class="hb-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`);
      }
      continue;
    }
    const value = key === "authors"
      ? fm.derived.authorsList.join(", ")
      : (fm.values[key] ?? "");
    if (!value) continue;
    const label = labels[key];
    items.push(
      label
        ? `<span class="hb-meta-item"><span class="hb-meta-label">${escapeHtml(label)}</span>${escapeHtml(value)}</span>`
        : `<span class="hb-meta-item">${escapeHtml(value)}</span>`
    );
  }
  if (!items.length) return "";
  return `<div class="hb-chapter-meta">${items.join("\n")}</div>`;
}

// 章节 cover 页：divider 同款版面（恰占一页 / 可出血），但标题不是真实
// h1——章的书签与锚点属于正文一级标题；出血定位经 data-hb-bleed-before
// 指向该锚点（官方管线覆盖"锚点页的前一页"）。
export function chapterCoverHtml(cover, { seq, anchorId, title, subtitle, metaLines = [], tags = [], lead = "" }) {
  const styleParts = [];
  if (cover.background) styleParts.push(`background: ${sanitizeCssValue(cover.background)};`);
  if (cover.color) styleParts.push(`color: ${sanitizeCssValue(cover.color)};`);
  const styleAttr = styleParts.length > 0 ? ` style="${escapeHtml(styleParts.join(" "))}"` : "";
  const bleedAttr = cover.bleed && anchorId ? ` data-hb-bleed-before="${escapeHtml(anchorId)}"` : "";
  const cls = ["insert", "hb-divider", "hb-chapter-cover", cover.className, lead]
    .filter(Boolean)
    .join(" ");

  const lines = [];
  if (title) lines.push(`<p class="hb-divider-title">${escapeHtml(title)}</p>`);
  if (subtitle) lines.push(`<p class="hb-divider-subtitle">${escapeHtml(subtitle)}</p>`);
  for (const line of metaLines) lines.push(`<p class="hb-divider-note">${escapeHtml(line)}</p>`);
  if (tags.length > 0) {
    lines.push(
      `<p class="hb-cover-tags">${tags
        .map((tag) => `<span class="hb-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`)
        .join(" ")}</p>`
    );
  }

  return (
    `<section class="${cls}" id="hb-chapter-cover-${seq}-sec"${bleedAttr}${styleAttr}>\n` +
    `<div class="hb-divider-inner">\n${lines.join("\n")}\n</div>\n` +
    "</section>"
  );
}
