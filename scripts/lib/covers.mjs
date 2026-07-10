// scripts/lib/covers.mjs — 封面 / 封底 section 的 HTML 构建。
// 默认组件与用户组件（cover.html / back_cover.html）走同一渲染路径；
// 占位符值在传入前已 HTML 转义。

import { renderTemplate } from "./util.mjs";

function defaultCoverBody(hasVersion) {
  return (
    '<h1 class="cover-title">{{title}}</h1>\n' +
    '<p class="cover-subtitle">{{subtitle}}</p>\n' +
    '<p class="cover-authors">{{authors}}</p>\n' +
    '<p class="cover-date">{{date}}</p>' +
    (hasVersion ? '\n<p class="cover-version">{{version}}</p>' : "")
  );
}

function defaultBackCoverBody(hasVersion) {
  return (
    '<div class="back-cover-inner">\n' +
    '<p class="back-cover-title">{{title}}</p>\n' +
    '<p class="back-cover-meta">{{authors}}</p>\n' +
    '<p class="back-cover-meta">{{date}}</p>\n' +
    (hasVersion ? '<p class="back-cover-meta">{{version}}</p>\n' : "") +
    "</div>"
  );
}

// cfg.html 指向用户组件文件时由 loadComponent 读取（含占位符填充）；
// 否则使用默认组件。enabled 为 false 时返回空串（不输出 section）。
export function buildCoverHtml({ enabled, cfg, metaValues, hasVersion, loadComponent }) {
  if (!enabled) return "";
  return (
    '<header id="cover" class="cover">\n' +
    (cfg.html
      ? loadComponent(cfg.html, "cover.html")
      : renderTemplate(defaultCoverBody(hasVersion), metaValues)) +
    "\n</header>"
  );
}

export function buildBackCoverHtml({ enabled, cfg, metaValues, hasVersion, loadComponent }) {
  if (!enabled) return "";
  return (
    '<footer id="back-cover" class="back-cover">\n' +
    (cfg.html
      ? loadComponent(cfg.html, "back_cover.html")
      : renderTemplate(defaultBackCoverBody(hasVersion), metaValues)) +
    "\n</footer>"
  );
}
