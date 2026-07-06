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

test("environments render without any auto-numbering; labels override built-ins", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nlabels:\n  note: "划重点"\n  theorem: "定理"\n' +
      "chapters:\n  - notes/01.md\n",
    "notes/01.md":
      "# 甲\n\n::: theorem 3.1 柯西不等式\n手动编号写在名称里。\n:::\n\n" +
      "::: definition\n默认英文标签。\n:::\n\n::: note\n要点。\n:::\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  // 标签 + 作者手写的名称（含手动编号），无括号包裹
  assert.match(html, /<span class="env-label">定理<\/span> <span class="env-name">3\.1 柯西不等式<\/span>/);
  assert.match(html, /<span class="env-label">Definition<\/span>/, "English default");
  assert.match(html, /<p class="admonition-title">划重点<\/p>/, "labels override");
  // 工具不生成任何编号或编号锚点
  assert.doesNotMatch(html, /id="theorem-/);
  assert.doesNotMatch(html, /class="fig-label"/);
  assert.doesNotMatch(html, /class="eq-block"/);
});

test("custom containers from labels are tip-styled admonitions", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/01.md]\n' +
      'labels:\n  keypoint: "划重点"\n  lemma: "引理"\n',
    "notes/01.md":
      "# A\n\n::: keypoint\n自定义告示。\n:::\n\n::: lemma 3.1 辅助结论\n标题整体可覆盖。\n:::\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /class="admonition admonition-custom admonition-keypoint"/);
  assert.match(html, /<p class="admonition-title">划重点<\/p>/);
  assert.match(html, /class="admonition admonition-custom admonition-lemma"/);
  assert.match(html, /<p class="admonition-title">3\.1 辅助结论<\/p>/, "inline title overrides label");
});

test("captions stay verbatim; manual \\tag renders; pagebreak marker works", async () => {
  const dir = await makeFixture({
    "book.yml": 'title: "T"\nlanguage: "en"\nchapters: [notes/01.md]\n',
    "notes/01.md":
      "# A\n\n![alt](./assets/p.png \"Fig. 3: my caption\")\n\n$$\nF = ma \\tag{3.1}\n$$\n\n\\pagebreak\n\nAfter the break.\n\n\\newpage\n\nEnd.\n",
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  // 图注原样输出——作者写的编号就是最终编号
  assert.match(html, /<figcaption>Fig\. 3: my caption<\/figcaption>/);
  assert.doesNotMatch(html, /fig-label/);
  // KaTeX 原生 \tag 渲染（工具不注入）
  assert.match(html, /class="tag"/);
  assert.doesNotMatch(html, /eq-block/);
  // 两种分页别名
  assert.equal(html.match(/class="hb-pagebreak"/g).length, 2);
  assert.doesNotMatch(html, /\\pagebreak/, "marker consumed");
});

test("labels validation; removed numbering option warns", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/a.md]\n' +
      "numbering:\n  figures: true\n" +
      'labels:\n  note: 5\n  "bad key": "x"\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /labels\.note must be a string/);
  assert.match(r.stderr, /custom container keys must match/);
  assert.match(r.stderr, /numbering: this option was removed/);
});

test("{{commit}} resolves from the note repo git (dirty suffix; empty outside git)", async () => {
  const { execSync } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const files = {
    "book.yml":
      'title: "T"\nchapters: [notes/01.md]\n' +
      'pdf:\n  header:\n    center: "{{commit}}"\n',
    "notes/01.md": "# A\n\ntext\n"
  };

  // 非 git 目录：占位符为空
  const plain = await makeFixture(files);
  let r = await runScript("build.mjs", { cwd: plain });
  assert.equal(r.code, 0, r.stderr);
  let html = await readOut(plain, "handout.html");
  assert.match(html, /hb-run-center"><\/span>/, "empty outside a git repo");

  // git 仓库：短 hash；工作区干净无 -dirty
  const repo = await makeFixture(files);
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: repo, stdio: "pipe" });
  git("init -q");
  git('config user.email "t@example.com"');
  git('config user.name "T"');
  git("add -A");
  git('commit -qm "init"');
  const hash = execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim();

  r = await runScript("build.mjs", { cwd: repo });
  assert.equal(r.code, 0, r.stderr);
  html = await readOut(repo, "handout.html");
  assert.match(html, new RegExp(`hb-run-center">${hash}<`), "clean tree: bare hash");

  // 弄脏工作区：-dirty 后缀
  await fs.writeFile(path.join(repo, "notes", "01.md"), "# A\n\nchanged\n");
  r = await runScript("build.mjs", { cwd: repo });
  assert.equal(r.code, 0, r.stderr);
  html = await readOut(repo, "handout.html");
  assert.match(html, new RegExp(`hb-run-center">${hash}-dirty<`), "dirty suffix");
});

test("chapters: .md is a chapter, .html is an insert, first body section is hb-lead", async () => {
  const dir = await makeFixture({
    "book.yml": 'title: "T"\nchapters:\n  - notes/a.md\n  - notes/mid.html\n  - notes/b.md\n',
    "notes/a.md": "# Aye\n\ntext\n",
    "notes/mid.html": '<div class="pause"><h2>Break {{title}}</h2></div>\n',
    "notes/b.md": "# Bee\n\ntext\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /<section class="chapter hb-lead" data-chapter="1"/);
  assert.match(html, /<section class="insert" data-entry="2"/);
  assert.match(html, /<section class="chapter" data-chapter="3"/);
  assert.match(html, /<h2>Break T<\/h2>/, "insert placeholder filled, markup verbatim");
});

test("chapters object form: per-entry class + chapter_toc build an isolated mini-TOC after the h1", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters:\n' +
      "  - path: notes/deep.md\n    class: deep-dive\n    chapter_toc: true\n",
    "notes/deep.md": "# Deep\n\nlead\n\n## One\n\na\n\n### Detail\n\nb\n\n## Two\n\nc\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /<section class="chapter deep-dive hb-lead"/, "custom class on the section");
  assert.match(html, /<\/h1>\s*<nav class="chapter-toc">/, "mini-TOC placed right after the h1");
  // Reuses the shared .toc-page[data-target] hook so PDF page numbers fill it.
  assert.match(html, /chapter-toc-title"><a href="#one">One<\/a>[\s\S]*?data-target="one"/);
  assert.match(html, /data-target="detail"/);
  assert.match(html, /data-target="two"/);
  // The mini-TOC uses its own isolated classes, distinct from the main .toc.
  assert.match(html, /<nav class="chapter-toc">/);
  assert.doesNotMatch(html, /<nav class="chapter-toc"[^>]*\bclass="toc"/);
});

test("chapter_toc global default + depth; chapters loaded from an external file", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: chapters.yml\n' +
      'chapter_toc:\n  default: true\n  title: "本章"\n  depth: 2\n',
    "chapters.yml": "- notes/a.md\n",
    "notes/a.md": "# A\n\n## Keep\n\nx\n\n### Drop\n\ny\n"
  });
  const r = await runScript("build.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);

  const html = await readOut(dir, "handout.html");
  assert.match(html, /<nav class="chapter-toc">/, "global default turns it on");
  assert.match(html, /<p class="chapter-toc-heading">本章<\/p>/, "custom title");
  assert.match(html, /data-target="keep"/);
  assert.doesNotMatch(html, /data-target="drop"/, "depth 2 excludes the h3");
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
