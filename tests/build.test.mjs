// tests/build.test.mjs — scripts/build.mjs 的输出断言（HTML / 首页 / 主题 / 资源）。

import test from "node:test";
import assert from "node:assert/strict";
import {
  makeFixture,
  runScript,
  readOut,
  outExists,
  baseBook,
  ALPHA_MD,
  BETA_MD,
  TINY_PNG
} from "./helpers.mjs";

const THEMES = `themes:
  - name: light
    label: "Light"
    default: true
  - name: dark
    label: "Dark"
    style:
      accent_color: "#eaeaea"
      custom_css: "templates/theme-dark.css"
`;

async function buildRichFixture() {
  const dir = await makeFixture({
    "book.yml": baseBook(THEMES),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  return dir;
}

test("rich build: markdown features render into handout.html", async () => {
  const dir = await buildRichFixture();
  const html = await readOut(dir, "handout.html");

  assert.match(html, /<mark>hl<\/mark>/, "==highlight==");
  assert.match(html, /class="katex"/, "KaTeX math");
  assert.match(html, /&lt;b&gt;html&lt;\/b&gt;/, "raw HTML must be escaped");
  assert.match(html, /<section class="chapter" data-chapter="2"/, "chapter sections");

  // 语法高亮：构建时着色
  assert.match(html, /language-js/, "fence language class");
  assert.match(html, /hljs-keyword/, "highlight.js tokens");

  // 图片：尺寸 + 图注
  assert.match(html, /<figure>/);
  assert.match(html, /style="width: 120px;"/);
  assert.match(html, /<figcaption>Cap 1<\/figcaption>/);

  // 脚注按章节命名空间化
  assert.match(html, /id="fn-ch1-1"/);
  assert.match(html, /id="fn-ch2-1"/);

  // 跨章节重复标题去重
  assert.match(html, /id="kraft"/);
  assert.match(html, /id="kraft-2"/);

  // 目录：链接 + 页码占位符
  assert.match(html, /class="toc-page" data-target="alpha"/);
  assert.match(html, /Contents/);

  // 网页打印运行页眉（thead 包裹）
  assert.match(html, /class="hb-sheet"/);
  assert.match(html, /class="hb-run"/);

  // 日期格式化（YYYY.MM.DD）
  assert.match(html, /2026\.01\.02/);

  // 外链新标签页
  assert.match(html, /target="_blank"/);
});

test("rich build: themes, index page, and assets", async () => {
  const dir = await buildRichFixture();

  // 暗色变体：独立文件、标题后缀、暗色调色板
  const dark = await readOut(dir, "handout.dark.html");
  assert.match(dark, /<title>Test Handout · Dark<\/title>/);
  assert.match(dark, /--hb-bg-page: #111111/);

  const light = await readOut(dir, "handout.html");
  assert.match(light, /<title>Test Handout<\/title>/);

  // 首页：章节导航（罗马数字）、主题入口、meta
  const index = await readOut(dir, "index.html");
  assert.match(index, /Alpha/);
  assert.match(index, /handout\.html#alpha/);
  assert.match(index, /<span class="no">I<\/span>/, "roman numeral for chapter 1");
  assert.match(index, /Dark/);
  assert.match(index, /handout\.dark\.pdf/);
  assert.match(index, /2 CHAPTERS/);

  // 资源复制
  assert.ok(await outExists(dir, "assets/p.png"), "notes assets copied");
  assert.ok(await outExists(dir, "assets/katex-fonts"), "katex fonts copied");
});

test("toc.enabled false removes the TOC; cover.enabled false restores first-page margins", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters:\n  - notes/01-alpha.md\n  - notes/02-beta.md\n' +
      "toc:\n  enabled: false\ncover:\n  enabled: false\n",
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.doesNotMatch(html, /<nav class="toc">/);
  assert.doesNotMatch(html, /id="cover"/);
  assert.match(html, /@page :first \{\n  margin: 18mm/, "first page margin restored without cover");
});

test("custom cover component is injected; placeholder values are HTML-escaped", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "A & <B>"\nchapters:\n  - notes/01-alpha.md\n' +
      'cover:\n  html: "templates/cover.html"\n',
    "notes/01-alpha.md": ALPHA_MD,
    "notes/assets/p.png": TINY_PNG,
    "templates/cover.html": '<p class="kick">K</p>\n<h1>{{title}}</h1>\n'
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /<p class="kick">K<\/p>/, "component markup injected as-is");
  assert.match(html, /<h1>A &amp; &lt;B&gt;<\/h1>/, "placeholder value HTML-escaped");
});

test("header_footer: false removes the web-print running header", async () => {
  const dir = await makeFixture({
    "book.yml": baseBook("pdf:\n  header_footer: false\n"),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.doesNotMatch(html, /class="hb-run"/);
});
