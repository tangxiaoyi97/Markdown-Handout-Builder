// tests/pdf.test.mjs — 官方 PDF 管线端到端回归（需要 Playwright Chromium）。
// 未安装浏览器时整组跳过（npx playwright install chromium）。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  makeFixture,
  runScript,
  baseBook,
  ALPHA_MD,
  BETA_MD,
  TINY_PNG,
  loadPdf,
  pageText,
  outlineTitles
} from "./helpers.mjs";

async function chromiumAvailable() {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const hasChromium = await chromiumAvailable();

async function buildAndRender(files) {
  const dir = await makeFixture(files);
  const b = await runScript("build.mjs", { cwd: dir });
  assert.equal(b.code, 0, b.stderr);
  const p = await runScript("render-pdf.mjs", { cwd: dir });
  assert.equal(p.code, 0, p.stderr);
  return { dir, pdfStderr: p.stderr };
}

test("official PDF: pages, outline, metadata, TOC page numbers, footer numbering", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": baseBook(),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });

  assert.doesNotMatch(pdfStderr, /Warning/, "pipeline must not warn on the happy path");

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    // 封面 + 目录 + 两章
    assert.equal(doc.numPages, 4);

    // 书签
    const titles = await outlineTitles(doc);
    assert.ok(titles.some((t) => /Alpha/.test(t)), `outline: ${titles.join(", ")}`);
    assert.ok(titles.some((t) => /Beta/.test(t)));

    // 元数据
    const { info } = await doc.getMetadata();
    assert.equal(info.Title, "Test Handout");
    assert.equal(info.Author, "A, B");
    assert.match(info.Creator ?? "", /Markdown Handout Builder/);

    // 目录页：标题 + 真实页码（Alpha 在第 3 页、Beta 在第 4 页）
    const toc = await pageText(doc, 2);
    assert.match(toc, /Contents/);
    assert.match(toc, /Alpha\s*3/);
    assert.match(toc, /Beta\s*4/);

    // 页脚页码（封面计数，默认 {{page}} / {{total}}）
    assert.match(toc, /2 \/ 4/);
    assert.match(await pageText(doc, 3), /3 \/ 4/);

    // 页眉（标题左 · 日期右，日期按 YYYY.MM.DD 格式化）
    assert.match(await pageText(doc, 3), /Test Handout/);
    assert.match(await pageText(doc, 3), /2026\.01\.02/);

    // PDF 语言元数据（catalog /Lang；pdf-lib 默认对象流压缩，需解析读取）
    const { PDFDocument, PDFName } = await import("pdf-lib");
    const parsed = await PDFDocument.load(await fs.readFile(path.join(dir, "dist", "handout.pdf")));
    const lang = parsed.catalog.get(PDFName.of("Lang"));
    assert.ok(lang, "catalog /Lang present");
    assert.match(String(lang), /en/);
  } finally {
    await destroy();
  }
});

test("count_cover:false + back cover: logical numbering and clean back page", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const extra = `pdf:
  page_numbers:
    format: "{{page}} / {{total}}"
    count_cover: false
    count_back_cover: false
back_cover:
  enabled: true
`;
  const { dir } = await buildAndRender({
    "book.yml": baseBook(extra),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    // 封面 + 目录 + 两章 + 封底
    assert.equal(doc.numPages, 5);

    // 逻辑页码：目录（物理第 2 页）显示 1 / 3
    const toc = await pageText(doc, 2);
    assert.match(toc, /1 \/ 3/);
    assert.match(toc, /Alpha\s*2/, "TOC numbers use logical pages");

    // 封底来自无页眉版：不带页码
    const back = await pageText(doc, 5);
    assert.doesNotMatch(back, /\/ 3/);
  } finally {
    await destroy();
  }
});

test("count_toc:false: main TOC excluded from numbering; chapter mini-TOC numbered", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const book = `title: "CT"
date: "2026-01-02"
chapters:
  - notes/01-alpha.md
  - path: notes/02-beta.md
    chapter_toc: true
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
toc:
  title: "Contents"
  depth: 1
pdf:
  page_numbers:
    format: "{{page}} / {{total}}"
    count_cover: false
    count_toc: false
  footer:
    left: ""
    center: "{{page}} / {{total}}"
    right: ""
`;
  const { dir } = await buildAndRender({
    "book.yml": book,
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    // cover + TOC + 2 chapters
    assert.equal(doc.numPages, 4);

    // Cover and TOC are excluded, so the body is numbered from 1. The TOC shows
    // those logical page numbers and carries no page number of its own.
    const toc = await pageText(doc, 2);
    assert.match(toc, /Alpha\s*1/, "logical: Alpha is page 1");
    assert.match(toc, /Beta\s*2/);
    assert.doesNotMatch(toc, /1 \/ 2/, "the TOC page itself is not numbered");

    // First chapter (physical page 3) is logical page 1.
    assert.match(await pageText(doc, 3), /1 \/ 2/);

    // Beta's chapter mini-TOC is present, numbered (Kraft -> 2), and the page is
    // counted (footer shows 2 / 2). The heading is uppercased via CSS.
    const beta = await pageText(doc, 4);
    assert.match(beta, /in this chapter/i, "chapter mini-TOC rendered");
    assert.match(beta, /Kraft\s*2/, "mini-TOC row gets a real page number");
    assert.match(beta, /2 \/ 2/);
  } finally {
    await destroy();
  }
});

test("sepia (light, non-white) theme: page base fill injected without warnings", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const themes = `themes:
  - name: sepia
    label: "Sepia"
    default: true
    style:
      accent_color: "#6b4f2a"
      custom_css: "templates/theme-sepia.css"
`;
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": baseBook(themes),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });

  assert.doesNotMatch(pdfStderr, /could not restyle/);

  // 浅色非白主题走"插入基底填充"分支：首个内容流以我们的整页填充开头
  // (#f6efdf = .9647 .9373 .8745)
  const zlib = await import("node:zlib");
  const { PDFDocument, PDFName, PDFArray, PDFRef, PDFRawStream } = await import("pdf-lib");
  const parsed = await PDFDocument.load(
    await fs.readFile(path.join(dir, "dist", "handout.pdf"))
  );
  const page2 = parsed.getPage(1);
  let ref = page2.node.get(PDFName.of("Contents"));
  if (ref instanceof PDFArray) ref = ref.get(0);
  assert.ok(ref instanceof PDFRef);
  const stream = parsed.context.lookup(ref);
  assert.ok(stream instanceof PDFRawStream);
  const text = zlib.inflateSync(Buffer.from(stream.contents)).toString("latin1");
  assert.match(text.slice(0, 120), /^q \.9647 \.9373 \.8745 rg 0 0 [\d.]+ [\d.]+ re f Q/);
});

test("dark theme PDF: variant file, title suffix, base recolor without warnings", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const themes = `themes:
  - name: light
    label: "Light"
    default: true
  - name: dark
    label: "Dark"
    style:
      accent_color: "#eaeaea"
      custom_css: "templates/theme-dark.css"
`;
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": baseBook(themes),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });

  // 基底色改写若失配会打警告——这是 Chromium 内容流格式漂移的哨兵
  assert.doesNotMatch(pdfStderr, /could not restyle/);

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.dark.pdf"));
  try {
    assert.equal(doc.numPages, 4);
    const { info } = await doc.getMetadata();
    assert.match(info.Title ?? "", /Test Handout – Dark/);
  } finally {
    await destroy();
  }
});
