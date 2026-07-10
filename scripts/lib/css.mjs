// scripts/lib/css.mjs — 主题 CSS 变量覆盖与内联样式表组装（纯函数）。
// 输入是已合并的主题配置，输出是注入 document.html <style> 的字符串片段。

import { sanitizeCssValue, marginParts, pageHeightMm } from "./util.mjs";

// book.yml style / pdf / cover / back_cover → :root 变量与 @page 覆盖
export function buildOverrideCss({
  styleCfg,
  pdfCfg,
  coverCfg,
  backCfg,
  coverEnabled,
  coverUsesHeaderFooter
}) {
  const varMap = {
    accent_color: "--hb-accent",
    content_width: "--hb-content-width",
    base_font_size: "--hb-base-font-size",
    print_font_size: "--hb-print-font-size"
  };
  const rootVars = Object.entries(varMap)
    .filter(([key]) => styleCfg[key])
    .map(([key, cssVar]) => `  ${cssVar}: ${sanitizeCssValue(styleCfg[key])};`);

  // 字体栈（style.fonts.body / heading / code）
  const fonts = styleCfg.fonts ?? {};
  if (fonts.body) rootVars.push(`  --hb-font-body: ${sanitizeCssValue(fonts.body)};`);
  if (fonts.heading) rootVars.push(`  --hb-font-heading: ${sanitizeCssValue(fonts.heading)};`);
  if (fonts.code) rootVars.push(`  --hb-font-code: ${sanitizeCssValue(fonts.code)};`);

  // 页眉页脚样式 → CSS 变量（网页打印的运行页眉与官方 PDF 保持一致外观）
  const hfStyleCfg = pdfCfg.header_footer_style ?? {};
  if (hfStyleCfg.font_size) rootVars.push(`  --hb-hf-font-size: ${sanitizeCssValue(hfStyleCfg.font_size)};`);
  if (hfStyleCfg.color) rootVars.push(`  --hb-hf-color: ${sanitizeCssValue(hfStyleCfg.color)};`);
  if (hfStyleCfg.font_family) rootVars.push(`  --hb-hf-font-family: ${sanitizeCssValue(hfStyleCfg.font_family)};`);

  // 封面 / 封底背景与文字色
  if (coverCfg.background) rootVars.push(`  --hb-cover-bg: ${sanitizeCssValue(coverCfg.background)};`);
  if (coverCfg.color) rootVars.push(`  --hb-cover-color: ${sanitizeCssValue(coverCfg.color)};`);
  if (backCfg.background) rootVars.push(`  --hb-back-bg: ${sanitizeCssValue(backCfg.background)};`);
  if (backCfg.color) rootVars.push(`  --hb-back-color: ${sanitizeCssValue(backCfg.color)};`);

  // pdf.margin 覆盖时，同步页边距镜像变量（封面/封底内容定位用）
  if (pdfCfg.margin) {
    const m = marginParts(sanitizeCssValue(pdfCfg.margin));
    rootVars.push(`  --hb-page-margin-top: ${m.top};`);
    rootVars.push(`  --hb-page-margin-right: ${m.right};`);
    rootVars.push(`  --hb-page-margin-bottom: ${m.bottom};`);
    rootVars.push(`  --hb-page-margin-left: ${m.left};`);
  }

  // 页面高度镜像变量：封底在普通页边距页上撑满正文区所需
  rootVars.push(`  --hb-page-height: ${pageHeightMm(pdfCfg.page_size)}mm;`);

  // 封面也要显示页眉页脚时：第一页恢复正常页边距，封面顶部留白相应减小
  if (coverUsesHeaderFooter) {
    rootVars.push("  --hb-cover-pad-top: 60mm;");
  }

  let overrideCss = "";
  if (rootVars.length > 0) {
    overrideCss += `:root {\n${rootVars.join("\n")}\n}\n`;
  }
  const pageRules = [];
  if (pdfCfg.page_size) pageRules.push(`size: ${sanitizeCssValue(pdfCfg.page_size)};`);
  if (pdfCfg.margin) pageRules.push(`margin: ${sanitizeCssValue(pdfCfg.margin)};`);
  if (pageRules.length > 0) {
    overrideCss += `@page {\n  ${pageRules.join("\n  ")}\n}\n`;
  }

  // 无封面 / 封面带页眉页脚时，第一页不再需要 margin:0 的全出血设定
  if (!coverEnabled || coverUsesHeaderFooter) {
    overrideCss += `@page :first {\n  margin: ${sanitizeCssValue(pdfCfg.margin ?? "18mm 16mm 20mm 16mm")};\n}\n`;
  }

  return overrideCss;
}

// 内联样式表的最终拼接顺序：KaTeX → print.css → book.yml 覆盖 → 自定义 CSS
// （后者优先级最高）。顺序是公开契约，主题/自定义 CSS 依赖它。
export function assembleInlineCss({ katexCss, printCss, overrideCss, customCss }) {
  return (
    `/* ===== KaTeX ===== */\n${katexCss}\n/* ===== print.css ===== */\n${printCss}` +
    (overrideCss ? `\n/* ===== book.yml overrides ===== */\n${overrideCss}` : "") +
    (customCss ? `\n/* ===== custom css ===== */\n${customCss}` : "")
  );
}
