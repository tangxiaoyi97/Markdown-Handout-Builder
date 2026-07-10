// scripts/lib/util.mjs — 纯工具函数，build.mjs / render-pdf.mjs / check.mjs 共用。
// 这里的函数无 I/O、无进程副作用，可直接单元测试。

import path from "node:path";
import { execSync } from "node:child_process";

export const toPosix = (p) => p.split(path.sep).join("/");

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function dateParts(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})(?:-?(\d{2})(?:-?(\d{2}))?)?/);
  if (!match) return null;
  return {
    YYYY: match[1],
    YY: match[1].slice(-2),
    MM: match[2] ?? "01",
    DD: match[3] ?? "01"
  };
}

export function formatDate(value, format = "YYYY-MM-DD") {
  const parts = dateParts(value);
  if (!parts) return String(value ?? "");

  const normalized = String(format || "YYYY-MM-DD").toLowerCase();
  const presets = {
    iso: "YYYY-MM-DD",
    "yyyy-mm-dd": "YYYY-MM-DD",
    yyyymmdd: "YYYYMMDD",
    yymmdd: "YYMMDD",
    "yyyy/mm/dd": "YYYY/MM/DD",
    "yy/mm/dd": "YY/MM/DD",
    "yyyy.mm.dd": "YYYY.MM.DD",
    "yy.mm.dd": "YY.MM.DD"
  };
  const pattern = presets[normalized] ?? String(format || "YYYY-MM-DD");

  return pattern
    .replaceAll("YYYY", parts.YYYY)
    .replaceAll("yyyy", parts.YYYY)
    .replaceAll("YY", parts.YY)
    .replaceAll("yy", parts.YY)
    .replaceAll("MM", parts.MM)
    .replaceAll("mm", parts.MM)
    .replaceAll("DD", parts.DD)
    .replaceAll("dd", parts.DD);
}

// 防止配置值破坏内联 <style>
export const sanitizeCssValue = (v) => String(v).replace(/[{}<>;]/g, "").trim();

// CSS margin 简写 → 上右下左
export function marginParts(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" };
  }
  const [a, b = a, c = a, d = b] = parts;
  return { top: a, right: b, bottom: c, left: d };
}

// pdf.page_size → 页面高度（mm）。print.css 用 --hb-page-height 把封底
// 撑满正文区（官方 PDF 管线再把封底覆盖为全出血整页）。
const PAGE_HEIGHTS_MM = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  b4: [250, 353],
  b5: [176, 250],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  ledger: [279.4, 431.8],
  tabloid: [279.4, 431.8]
};

export function pageHeightMm(size) {
  const raw = String(size ?? "A4").trim().toLowerCase();
  const landscape = /\blandscape\b/.test(raw);
  const keyword = raw.replace(/\b(landscape|portrait)\b/g, "").trim();
  const named = PAGE_HEIGHTS_MM[keyword];
  if (named) return landscape ? named[0] : named[1];
  // 显式尺寸："210mm 297mm" 之类；单值为正方形页。取第二个长度为高。
  const toMm = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
  const lengths = [...keyword.matchAll(/([\d.]+)\s*(mm|cm|in|pt|px)/g)].map(
    (m) => Number.parseFloat(m[1]) * toMm[m[2]]
  );
  if (lengths.length >= 2) return lengths[1];
  if (lengths.length === 1) return lengths[0];
  return 297; // 未知关键字：回退 A4 高度
}

// 模板填充：单遍替换，插入的内容不会被二次扫描
export function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key) =>
    Object.hasOwn(values, key) ? values[key] : whole
  );
}

export function slugifyHeading(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// 构建溯源元数据：{{commit}} = 笔记仓库的短 hash（非 git 目录时为空串）。
// 有未提交改动时加 -dirty 后缀，避免产物标注一个不含当前内容的 hash。
// 注意 cwd 是 baseDir（笔记仓库），不是本工具的仓库。
export function resolveGitCommit(dir) {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    if (!hash) return "";
    const dirty = execSync("git status --porcelain", {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "";
  }
}
