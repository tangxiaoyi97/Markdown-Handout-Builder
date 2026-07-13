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

test("layout freedom PDF: divider occupies one page, bleed overlay lands on it, blank page ships", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": `title: "Plates"
date: "2026-01-02"
cover:
  enabled: false
chapters:
  - notes/01-one.md
  - divider:
      title: "第二部分"
      background: "#25304a"
      color: "#ffffff"
      bleed: true
      toc: "第二部分"
  - blank: true
  - notes/02-two.md
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
`,
    "notes/01-one.md": "# One\n\nBody.\n",
    "notes/02-two.md": "# Two\n\nBody.\n"
  });

  // 出血定位不允许静默失败
  assert.doesNotMatch(pdfStderr, /cannot locate the page of bleed divider/);
  assert.doesNotMatch(pdfStderr, /spans \d+ pages/);

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    // 无封面：TOC(1) + One(2) + divider(3) + blank(4) + Two(5)
    assert.equal(doc.numPages, 5);
    // 文本抽取可能把 CJK 映射成康熙部首变体（二 → ⼆），按两种写法匹配
    const PART_TWO = /第\s*[二⼆]\s*部分/;
    assert.match(await pageText(doc, 3), PART_TWO);
    // 空白页：正常计页、带页眉页脚，但没有任何正文
    const blankText = await pageText(doc, 4);
    assert.match(blankText, /4 \/ 5/);
    assert.doesNotMatch(blankText, /One|Two/);
    assert.doesNotMatch(blankText, PART_TWO);
    assert.match(await pageText(doc, 5), /Two/);
    // divider 的 h1 进入书签；主目录含 divider 行与页码
    assert.ok((await outlineTitles(doc)).includes("第二部分"));
    assert.match(await pageText(doc, 1), /第\s*[二⼆]\s*部分\s*3/);
  } finally {
    await destroy();
  }
});

test("per-chapter running profile: custom bands/page numbers and global restoration", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": `title: Running Policy
date: "2026-01-02"
cover: { enabled: false }
toc: { enabled: false }
structure:
  - type: chapter
    path: notes/custom.md
    running:
      header:
        left: "{{chapterTitle}}"
        center: "CHAPTER-HEADER"
      footer:
        left: "CHAPTER-ONLY"
        center: "{{page}} / {{total}}"
        right: "本章专属"
      style:
        font_size: "9px"
        color: "#345678"
  - type: chapter
    path: notes/normal.md
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
pdf:
  footer:
    left: "FOOTER-MARK"
    center: "{{page}} / {{total}}"
    right: ""
`,
    "notes/custom.md": "# Custom Chapter\n\nThis chapter has its own running bands.\n",
    "notes/normal.md": "# Normal Footer\n\nThis chapter uses the global footer.\n"
  });

  assert.doesNotMatch(pdfStderr, /cannot map section pages/);
  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    assert.equal(doc.numPages, 2);
    const custom = await pageText(doc, 1);
    const normal = await pageText(doc, 2);
    assert.match(custom, /Custom Chapter/);
    assert.match(custom, /CHAPTER-HEADER/);
    assert.match(custom, /CHAPTER-ONLY/);
    assert.match(custom, /1 \/ 2/);
    assert.match(normal, /Normal Footer/);
    assert.match(normal, /FOOTER-MARK/);
    assert.doesNotMatch(normal, /CHAPTER-HEADER|CHAPTER-ONLY/);
  } finally {
    await destroy();
  }
});

test("per-chapter running profile can opt bands in when globally disabled", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir } = await buildAndRender({
    "book.yml": `title: Local Opt In
cover: { enabled: false }
toc: { enabled: false }
structure:
  - path: notes/custom.md
    running:
      header: { center: "LOCAL-HEADER" }
      footer: { center: "{{page}} / {{total}}" }
  - path: notes/normal.md
output: { html: dist/handout.html, pdf: dist/handout.pdf }
pdf:
  header_footer: false
`,
    "notes/custom.md": "# Custom\n\nLocal bands.\n",
    "notes/normal.md": "# Normal\n\nNo bands.\n"
  });

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    const custom = await pageText(doc, 1);
    const normal = await pageText(doc, 2);
    assert.match(custom, /LOCAL-HEADER/);
    assert.match(custom, /1 \/ 2/);
    assert.doesNotMatch(normal, /LOCAL-HEADER|2 \/ 2/);
  } finally {
    await destroy();
  }
});

test("running profile stops before blank, HTML insert, and next chapter cover", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": `title: Running Boundaries
cover: { enabled: false }
structure:
  - path: notes/a.md
    running:
      footer: { left: "CUSTOM-A" }
  - type: blank
  - type: contents
  - type: insert
    path: notes/interlude.html
    running:
      footer: { right: "HTML-ONLY" }
  - path: notes/b.md
    cover:
      title: "B COVER"
      background: "#e8edf7"
output: { html: dist/handout.html, pdf: dist/handout.pdf }
toc: { title: "Contents" }
pdf:
  footer:
    left: "GLOBAL-FOOTER"
    center: "{{page}} / {{total}}"
    right: ""
`,
    "notes/a.md": "# Chapter A\n\nCustom running profile.\n",
    "notes/interlude.html": "<h2>Interlude</h2><p>Raw HTML page.</p>",
    "notes/b.md": "# Chapter B\n\nGlobal running profile.\n"
  });

  assert.doesNotMatch(pdfStderr, /cannot map running-profile boundaries|unmapped sections/);
  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    assert.equal(doc.numPages, 6);
    assert.match(await pageText(doc, 1), /CUSTOM-A/);
    for (const pageNo of [2, 3, 4, 5, 6]) {
      const text = await pageText(doc, pageNo);
      assert.doesNotMatch(text, /CUSTOM-A/, `custom profile leaked onto page ${pageNo}`);
    }
    assert.match(await pageText(doc, 3), /Contents/);
    assert.match(await pageText(doc, 4), /Interlude/);
    assert.match(await pageText(doc, 4), /HTML-ONLY/);
    assert.match(await pageText(doc, 5), /B COVER/);
    assert.doesNotMatch(await pageText(doc, 5), /HTML-ONLY/);
    assert.match(await pageText(doc, 6), /Chapter B/);
    assert.match(await pageText(doc, 6), /GLOBAL-FOOTER/);
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

    // The excluded TOC is copied from the all-sections render. Its annotations
    // must still resolve after named destinations are remapped into the final PDF.
    const tocPage = await doc.getPage(2);
    const tocLinks = (await tocPage.getAnnotations()).filter(
      (annotation) => typeof annotation.dest === "string"
    );
    assert.ok(tocLinks.length >= 2, "TOC exposes internal link annotations");
    for (const link of tocLinks) {
      assert.ok(await doc.getDestination(link.dest), `TOC destination resolves: ${link.dest}`);
    }

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

  // 浅色非白主题走"插入页边距条"分支：首个内容流以四条边距填充开头。
  // 不得恢复为整页矩形，否则透明/媒体合成层可能被 Poppler 渲成黑块。
  // #f6efdf = .9647 .9373 .8745
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
  const prelude = text.slice(0, text.indexOf("Q\n") + 2);
  assert.match(prelude, /^q \.9647 \.9373 \.8745 rg\n/);
  assert.equal((prelude.match(/ re f/g) ?? []).length, 4, "four page-margin strips");
  assert.doesNotMatch(prelude, /0 0 594\.96 841\.89 re f/, "no full-page fill");
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

test("Obsidian Mermaid is rendered before PDF pagination", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": `title: "Diagram"
chapters: [notes/diagram.md]
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
cover:
  enabled: false
toc:
  enabled: false
markdown:
  dialect: obsidian
`,
    "notes/diagram.md": `# Diagram

\`\`\`mermaid
flowchart LR
  SourceNode --> TargetNode
\`\`\`
`
  });
  assert.doesNotMatch(pdfStderr, /Warning/);

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    const text = await pageText(doc, 1);
    assert.match(text, /SourceNode/, "Mermaid source node rendered into PDF");
    assert.match(text, /TargetNode/, "Mermaid target node rendered into PDF");
  } finally {
    await destroy();
  }
});

test("v3 PDF: chapter cover bleeds onto the page before its chapter; running fm footer applies", { skip: !hasChromium && "Playwright Chromium not installed" }, async () => {
  const { dir, pdfStderr } = await buildAndRender({
    "book.yml": `title: "FM3"
date: "2026-01-02"
cover:
  enabled: false
frontmatter:
  meta: [modified]
structure:
  - type: chapter
    path: notes/01-one.md
  - type: chapter
    path: notes/02-two.md
    cover:
      background: "#25304a"
      color: "#ffffff"
      bleed: true
    running:
      footer:
        center: "{{fm.status}}"
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
`,
    "notes/01-one.md": "# One\n\nBody.\n",
    "notes/02-two.md": `---
title: "第二章"
status: FINAL-DRAFT
modified: 2026-01-01
---
# Two

Body two.
`
  });

  assert.doesNotMatch(pdfStderr, /cannot locate the page before anchor/);

  const { doc, destroy } = await loadPdf(path.join(dir, "dist", "handout.pdf"));
  try {
    // TOC(1) + One(2) + chapter cover(3) + Two(4)
    assert.equal(doc.numPages, 4);
    // 文本抽取可能把 CJK 映射成康熙部首变体（二 → ⼆），按两种写法匹配
    const CHAPTER_TITLE = /第\s*[二⼆]\s*章/;
    const coverText = await pageText(doc, 3);
    assert.match(coverText, CHAPTER_TITLE); // cover 标题 = fm.title
    assert.match(coverText, /2026-01-01/);  // 默认元信息行（更新时间）
    const chapterText = await pageText(doc, 4);
    assert.match(chapterText, /Body two/);
    assert.match(chapterText, /FINAL-DRAFT/); // running fm 页脚
    // cover 标题不是书签；章 h1 是
    const titles = await outlineTitles(doc);
    assert.ok(titles.includes("Two"));
    assert.equal(titles.filter((t) => CHAPTER_TITLE.test(t)).length, 0);
  } finally {
    await destroy();
  }
});
