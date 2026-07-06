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

  // 版本号：默认封面显示
  assert.match(html, /<p class="cover-version">2\.1<\/p>/);

  // 告示块：自定义标题 + 默认标题
  assert.match(html, /class="admonition admonition-warning"/);
  assert.match(html, /<p class="admonition-title">Check units<\/p>/);
  assert.match(html, /class="admonition admonition-tip"/);
  assert.match(html, /<p class="admonition-title">Tip<\/p>/);
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

test("{{version}} placeholder renders in header slots; index shows the version", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nversion: "Rev. B"\nchapters:\n  - notes/01-alpha.md\n' +
      'pdf:\n  header:\n    center: "{{version}}"\n',
    "notes/01-alpha.md": ALPHA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /hb-run-center">Rev\. B</, "running header center slot");

  const index = await readOut(dir, "index.html");
  assert.match(index, /<span>Rev\. B<\/span>/, "index meta line");
});

test("built-in sepia and academic themes build as variants", async () => {
  const themes = `themes:
  - name: light
    default: true
  - name: sepia
    style:
      custom_css: "templates/theme-sepia.css"
  - name: academic
    style:
      custom_css: "templates/theme-academic.css"
`;
  const dir = await makeFixture({
    "book.yml": baseBook(themes),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const sepia = await readOut(dir, "handout.sepia.html");
  assert.match(sepia, /--hb-bg-page: #ede3cd/);

  const academic = await readOut(dir, "handout.academic.html");
  assert.match(academic, /--hb-font-body: Georgia/);
});

test("numbered environments; labels override built-ins; per-chapter reset", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nlabels:\n  note: "划重点"\n  theorem: "定理"\n  example: "例"\n' +
      "chapters:\n  - notes/01.md\n  - notes/02.md\n",
    "notes/01.md":
      "# 甲\n\n::: theorem 柯西不等式\n内容。\n:::\n\n::: example\n例子。\n:::\n\n::: note\n要点。\n:::\n\n::: definition\n默认英文标签。\n:::\n",
    "notes/02.md": "# 乙\n\n::: theorem\n第二章定理。\n:::\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /id="theorem-1-1"/);
  assert.match(html, /<span class="env-label">定理 1\.1<\/span>/);
  assert.match(html, /<span class="env-name">\(柯西不等式\)<\/span>/);
  assert.match(html, /<span class="env-label">例 1\.1<\/span>/);
  assert.match(html, /<span class="env-label">Definition 1\.1<\/span>/, "English default");
  assert.match(html, /<span class="env-label">定理 2\.1<\/span>/, "per-chapter reset");
  assert.match(html, /<p class="admonition-title">划重点<\/p>/, "labels override");
});

test("custom containers from labels: tip-styled admonition and numbered environment", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/01.md]\n' +
      'labels:\n  keypoint: "划重点"\n  lemma:\n    text: "引理"\n    numbered: true\n',
    "notes/01.md":
      "# A\n\n::: keypoint\n自定义告示。\n:::\n\n::: lemma 覆盖名\n自定义环境。\n:::\n\n::: lemma\n第二个。\n:::\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  // 字符串值 → 提示样式告示块 + 专属 class
  assert.match(html, /class="admonition admonition-custom admonition-keypoint"/);
  assert.match(html, /<p class="admonition-title">划重点<\/p>/);
  // 对象值 numbered → 编号环境 + 专属 class + 锚点
  assert.match(html, /class="env env-custom env-lemma" id="lemma-1-1"/);
  assert.match(html, /<span class="env-label">引理 1\.1<\/span>/);
  assert.match(html, /<span class="env-label">引理 1\.2<\/span>/);
});

test("figure and equation numbering; manual \\tag skipped; pagebreak marker", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nlanguage: "en"\nchapters: [notes/01.md]\n' +
      "numbering:\n  figures: true\n  equations: true\n",
    "notes/01.md":
      "# A\n\n![alt](./assets/p.png \"A caption\")\n\n$$\nE = mc^2\n$$\n\n$$\nF = ma \\tag{X}\n$$\n\n\\pagebreak\n\nAfter the break.\n",
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /<span class="fig-label">Figure 1\.1<\/span> A caption/);
  assert.match(html, /<figure id="figure-1-1">/);
  assert.match(html, /<div class="eq-block" id="eq-1-1">/);
  assert.equal(html.match(/class="eq-block"/g).length, 1, "manual \\tag not auto-numbered");
  assert.match(html, /<div class="hb-pagebreak"/);
  assert.doesNotMatch(html, /\\pagebreak/, "marker consumed");
});

test("numbering and labels validation", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/a.md]\n' +
      'numbering:\n  figures: "yes"\n' +
      'labels:\n  note: 5\n  "bad key": "x"\n  lemma:\n    numbered: true\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /numbering\.figures must be true or false/);
  assert.match(r.stderr, /labels\.note must be a string or a mapping/);
  assert.match(r.stderr, /custom container keys must match/);
  assert.match(r.stderr, /labels\.lemma\.text must be a non-empty string/);
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
