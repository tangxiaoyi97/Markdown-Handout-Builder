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

  const lines = [];
  if (entry.title) {
    lines.push(
      `<h1 class="hb-divider-title" id="${headingId}" tabindex="-1">${escapeHtml(entry.title)}</h1>`
    );
  }
  if (entry.subtitle) lines.push(`<p class="hb-divider-subtitle">${escapeHtml(entry.subtitle)}</p>`);
  if (entry.note) lines.push(`<p class="hb-divider-note">${escapeHtml(entry.note)}</p>`);

  return (
    `<section class="${cls}" id="${headingId}-sec"${bleedAttr}${styleAttr}>\n` +
    `<div class="hb-divider-inner">\n${lines.join("\n")}\n</div>\n` +
    "</section>"
  );
}

// 占位空白页：占据整整一页（双面印刷的对页排版）。不带运行页眉。
export function blankSectionHtml() {
  return '<section class="insert hb-blank" aria-hidden="true"></section>';
}
