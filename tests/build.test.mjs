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

test("built-in sepia, clay, and academic themes build as variants", async () => {
  const themes = `themes:
  - name: light
    default: true
  - name: sepia
    style:
      custom_css: "templates/theme-sepia.css"
  - name: clay
    style:
      custom_css: "templates/theme-clay.css"
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

  const clay = await readOut(dir, "handout.clay.html");
  assert.match(clay, /--hb-mark-bg: #e49d7e/, "clay palette");

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

test("Obsidian dialect: properties, links, blocks, tasks, tags, comments, callouts, and HTML", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "Obsidian"\nchapters: [notes/Home.md, notes/Target.md]\n' +
      'markdown:\n  dialect: obsidian\n  obsidian:\n    properties: visible\n',
    "notes/Home.md": `---
aliases: [Start]
tags: [guide, test/nested]
cssclasses: [wide-note]
rating: 5
related: "Read [[Target]] at https://example.com"
---
# Home

See [[Target|the target]], [[Target#Details]], [[Target#^fact]], and [Markdown form](Target.md#Details).

Same note: [[#Home]]. Hierarchy: [[Target#Target#Details]].

| Link |
| -- |
| [[Target\\|Table alias]] |

#topic/sub

This stays. %%This secret must disappear.%%

%%
Block secret must disappear too.
%%

Inline code keeps \`%%literal%%\`.

<kbd>Raw HTML</kbd>

- [ ] open task
- [?] custom completed task

> [!tip]+ Fold me
> Body with **formatting** and [[Target]].

> [!question] Outer
> > [!todo]- Inner
> > Nested body.

![[Target#Details]]

![[assets/p.png|64x32]]
`,
    "notes/Target.md": `# Target

Fact paragraph. ^fact

## Details

Embedded detail.

## After

Not in the section embed.

- list one
- list two

^list-id

Back to [[Start]].
`,
    "notes/assets/p.png": TINY_PNG
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");

  assert.match(html, /class="chapter wide-note hb-lead"/, "cssclasses property applies to chapter");
  assert.match(html, /class="obsidian-properties"/);
  assert.match(html, /Read <a class="internal-link" href="#target"[^>]*>Target<\/a> at <a href="https:\/\/example\.com"/);
  // Properties UI shows tag pills without the leading '#'; inline tags keep it.
  assert.match(html, /data-tag="guide">guide</);
  assert.match(html, /class="obsidian-tag" data-tag="topic\/sub">#topic\/sub/);
  assert.doesNotMatch(html, /secret must disappear/);
  assert.match(html, /<code>%%literal%%<\/code>/);
  assert.match(html, /<kbd>Raw HTML<\/kbd>/);
  assert.match(html, /class="task-list-item" data-task=" "/);
  assert.match(html, /class="task-list-item" data-task="\?"/);
  assert.match(html, /<details class="callout callout-tip is-collapsible"[^>]* open>/);
  assert.match(html, /class="callout callout-question"/);
  assert.match(html, /<details class="callout callout-todo is-collapsible"[^>]*>/);
  assert.doesNotMatch(html, /callout-todo is-collapsible"[^>]* open/);
  assert.match(html, /<strong>formatting<\/strong>/);
  assert.match(html, /class="internal-link" href="#target"[^>]*>the target<\/a>/);
  assert.match(html, /class="internal-link" href="#target"[^>]*>Table alias<\/a>/);
  assert.match(html, /data-href="#Home"/);
  assert.match(html, /data-href="Target#Target#Details"/);
  assert.match(html, /data-href="Start"[^>]*>Start<\/a>/);
  assert.match(html, /class="internal-link" href="#details-2"[^>]*data-href="Target#Details"/);
  assert.match(html, /href="#obsidian-block-notes-target-md-fact-ch2"/);
  assert.match(html, /class="obsidian-note-embed" data-source="notes\/Target\.md#Details"/);
  assert.match(html, /Embedded detail/);
  // Transcluded headings are demoted out of the a11y tree / PDF outline.
  assert.match(html, /<h2 role="paragraph" id="details"/);
  assert.doesNotMatch(
    html.match(/class="obsidian-note-embed"[\s\S]*?<\/div>/)?.[0] ?? "",
    /Not in the section embed/
  );
  assert.match(html, /class="obsidian-embed-image"[^>]*src="vault\/notes\/assets\/p\.png"[^>]*width: 64px; height: 32px/);
  assert.ok(await outExists(dir, "vault/notes/assets/p.png"), "Obsidian attachment copied");
});

test("layout freedom: as:insert, divider, blank, in-flow contents, per-entry toc", async () => {
  const dir = await makeFixture({
    "book.yml": `title: "Free Layout"
chapters:
  - path: front/preface.md
    as: insert
    class: preface
  - contents: true
  - divider:
      title: "第一部分"
      subtitle: "Basics"
      background: "#223"
      color: "#fff"
      toc: "第一部分 · 基础"
  - notes/01-one.md
  - blank: true
  - path: notes/02-two.md
    toc: "第二章（改名）"
  - path: notes/03-secret.md
    toc: false
`,
    "front/preface.md": "# 前言\n\n这一页不进目录。\n",
    "notes/01-one.md": "# One\n\nBody.\n",
    "notes/02-two.md": "# Two\n\nBody.\n",
    "notes/03-secret.md": "# Secret\n\nBody.\n"
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");

  // as:insert 的 Markdown 页：insert 语义 + 自定义 class，正文照常渲染
  assert.match(html, /<section class="insert preface hb-lead" data-entry="1">/);
  assert.match(html, /这一页不进目录/);

  // in-flow contents：主目录出现在正文流（preface 之后），模板槽位不再有第二份
  assert.equal((html.match(/<nav class="toc" id="toc"/g) ?? []).length, 1);
  assert.match(html, /<nav class="toc" id="toc" data-hb-in-flow="true">/);
  const tocPos = html.indexOf('<nav class="toc"');
  const prefacePos = html.indexOf('data-entry="1"');
  const dividerPos = html.indexOf("hb-divider-1-sec");
  assert.ok(prefacePos < tocPos && tocPos < dividerPos, "contents sits between preface and divider");

  // divider：标题成为真实 h1；toc 文案进入主目录并带页码占位
  assert.match(html, /<h1 class="hb-divider-title" id="hb-divider-1"/);
  assert.match(html, /<a href="#hb-divider-1">第一部分 · 基础<\/a>/);
  assert.match(html, /data-target="hb-divider-1"/);

  // blank 占位页
  assert.match(html, /<section class="insert hb-blank" aria-hidden="true">/);

  // 每条目 toc 控制：改名生效；toc:false 的章节不在主目录但正文仍在
  assert.match(html, /<a href="#two">第二章（改名）<\/a>/);
  assert.doesNotMatch(html, /<a href="#secret">/);
  assert.match(html, /<h1 id="secret"/);

  // 主目录只有 divider + One + Two（preface/secret 除外）
  const tocNav = html.match(/<nav class="toc"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.equal((tocNav.match(/class="toc-row"/g) ?? []).length, 3);
});

test("structure DSL: layout inheritance, semantic parts, includes, flow, and navigation", async () => {
  const dir = await makeFixture({
    "book.yml": `title: Structured Book
layouts:
  body:
    class: layout-body
    chapter_toc: true
  compact:
    extends: body
    class: layout-compact
    flow:
      break_before: auto
structure:
  - type: part
    title: Part One
    navigation:
      label: I · Foundations
      level: 1
    defaults:
      layout: compact
    children:
      - type: chapter
        path: notes/a.md
      - include: parts/more.yml
  - type: chapter
    path: notes/hidden.md
    navigation:
      toc: false
      outline: false
toc:
  depth: 3
`,
    "parts/more.yml": `- type: chapter
  path: notes/b.md
  navigation:
    label: Renamed B
`,
    "notes/a.md": "# Alpha\n\n## Detail\n\nA.\n",
    "notes/b.md": "# Beta\n\nB.\n",
    "notes/hidden.md": "# Hidden\n\nNot in navigation.\n"
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");

  assert.match(html, /class="chapter layout-body layout-compact hb-break-before-auto"/);
  assert.match(html, /data-layout="compact"/);
  assert.match(html, /<nav class="chapter-toc">/);
  assert.match(html, /<a href="#hb-divider-1">I · Foundations<\/a>/);
  assert.match(html, /<a href="#alpha">Alpha<\/a>/);
  assert.match(html, /<a href="#beta">Renamed B<\/a>/);
  assert.doesNotMatch(html.match(/<nav class="toc"[\s\S]*?<\/nav>/)?.[0] ?? "", /Hidden/);
  assert.match(html, /<h1 role="paragraph" id="hidden"/);
});

test("per-chapter running policy: content/style override and suppression are serialized", async () => {
  const dir = await makeFixture({
    "book.yml": `title: Running Profiles
structure:
  - type: chapter
    path: notes/plain.md
    running:
      header:
        center: "{{chapterTitle}}"
      footer:
        left: "CHAPTER-ONLY"
      style:
        color: "#345678"
  - type: chapter
    path: notes/normal.md
    running:
      footer: false
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
`,
    "notes/plain.md": "# Plain Markdown\n\nRendered normally, without a PDF footer.\n",
    "notes/normal.md": "# Normal\n\nDefault running footer.\n"
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");
  const plain = html.match(/<section[^>]*data-hb-anchor="plain-markdown"[^>]*>/)?.[0] ?? "";
  assert.match(plain, /data-hb-running=/);
  assert.match(plain, /&quot;center&quot;:&quot;\{\{chapterTitle\}\}&quot;/);
  assert.match(plain, /&quot;left&quot;:&quot;CHAPTER-ONLY&quot;/);
  assert.match(plain, /&quot;color&quot;:&quot;#345678&quot;/);
  const normal = html.match(/<section[^>]*data-hb-anchor="normal"[^>]*>/)?.[0] ?? "";
  assert.match(normal, /data-hb-running-footer="false"/);
  assert.match(normal, /data-hb-running=/);
});

test("Obsidian dialect: frontmatter edge cases and inline-parser hardening", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "Edges"\nchapters: [notes/Empty.md, notes/Comma.md, notes/Hard.md]\n' +
      "markdown:\n  dialect: obsidian\n",
    // Obsidian's empty properties form: must be swallowed, not rendered as <hr>.
    "notes/Empty.md": "---\n---\n# Empty FM\n\nBody stays.\n",
    // Comma-separated scalars normalize into separate list items.
    "notes/Comma.md": `---
tags: alpha, beta
aliases: One, Two
---
# Comma

Alias link works: [[One]].
`,
    // Silent-mode validation used to crash on wikilinks/tags inside link labels;
    // tags after CJK punctuation stay plain text; callout titles must not
    // swallow the note's footnote section.
    "notes/Hard.md": `---
note: contains %% and a stray \` tick
---
# Hard

A [#tag](https://example.com) label and [a [[One]] label](https://example.com).

标点紧邻：#notplain 之后 (#alsonot) 空白之后 #realtag 收尾。

Inline footnote lives here.^[the footnote text]

> [!tip] Titled callout
> Body.
`
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");

  // Empty frontmatter: recognized and hidden — no leaked rules before the h1.
  assert.doesNotMatch(html, /<hr>\s*<hr>/);
  assert.match(html, /<h1 id="empty-fm"/);

  // Comma normalization: two tag pills (no '#' in the Properties UI), and the
  // alias participates in wikilink resolution.
  assert.match(html, /data-tag="alpha">alpha</);
  assert.match(html, /data-tag="beta">beta</);
  assert.match(html, /class="internal-link" href="#comma"[^>]*data-href="One"/);

  // Inline-parser hardening: the build survived (no skipToken crash) and the
  // link labels rendered; only whitespace-preceded tags become pills.
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*>#tag<\/a>/);
  assert.doesNotMatch(html, /data-tag="notplain"/);
  assert.doesNotMatch(html, /data-tag="alsonot"/);
  assert.match(html, /class="obsidian-tag" data-tag="realtag"/);

  // Footnote isolation: the callout title contains no footnote section; the
  // footnote list renders exactly once.
  const calloutTitle = html.match(/<div class="callout-title">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.doesNotMatch(calloutTitle, /footnotes/);
  assert.equal(html.match(/<section class="footnotes">/g)?.length, 1);
});

test("Obsidian dialect: note embed cycles are bounded and reported", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/A.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/A.md": "# A\n\n![[B]]\n",
    "notes/B.md": "# B\n\n![[A]]\n"
  });
  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /Cyclic Obsidian note embed skipped/);
  const html = await readOut(dir, "handout.html");
  assert.match(html, /Cyclic embed/);
});

test("Obsidian dialect: Mermaid is initialized offline and copied to dist", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/A.md, notes/B.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/A.md":
      "# A\n\n```mermaid\ngraph TD\n  A --> B\n  class A,B internal-link;\n```\n",
    "notes/B.md": "# B\n"
  });
  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");
  assert.match(html, /<pre class="mermaid">graph TD/);
  assert.match(html, /click A href &quot;#a&quot;/, "Obsidian Mermaid internal link A");
  assert.match(html, /click B href &quot;#b&quot;/, "Obsidian Mermaid internal link B");
  assert.match(html, /assets\/mermaid\.min\.js/);
  assert.match(html, /window\.__MHB_RENDER_READY__/);
  assert.ok(await outExists(dir, "assets/mermaid.min.js"));
  assert.ok(await outExists(dir, "assets/mermaid.LICENSE"));
});

test("Obsidian dialect: official attachment embeds render and copy offline", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/A.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/A.md": `# Attachments

![[media/sound.mp3]]

![[media/movie.mp4|320x180]]

![[media/paper.pdf#page=3#height=420]]

![[boards/map.canvas]]

![[views/library.base]]
`,
    "notes/media/sound.mp3": Buffer.from("audio"),
    "notes/media/movie.mp4": Buffer.from("video"),
    "notes/media/paper.pdf": Buffer.from("%PDF-dummy"),
    "notes/boards/map.canvas": '{"nodes":[],"edges":[]}',
    "notes/views/library.base": "filters: []\n"
  });
  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");
  assert.match(html, /<audio class="obsidian-embed-audio"[^>]*sound\.mp3/);
  assert.match(html, /<video class="obsidian-embed-video"[^>]*movie\.mp4[^>]*width: 320px; height: 180px/);
  assert.match(html, /class="obsidian-embed-pdf"[^>]*paper\.pdf#page=3[^>]*height: 420px/);
  assert.match(html, /class="obsidian-file-embed"[^>]*map\.canvas/);
  assert.match(html, /class="obsidian-file-embed"[^>]*library\.base/);
  for (const file of [
    "vault/notes/media/sound.mp3",
    "vault/notes/media/movie.mp4",
    "vault/notes/media/paper.pdf",
    "vault/notes/boards/map.canvas",
    "vault/notes/views/library.base"
  ]) {
    assert.ok(await outExists(dir, file), `${file} copied`);
  }
});

test("v3 frontmatter: strip in standard dialect, meta band, title injection, cover, running fm", async () => {
  const dir = await makeFixture({
    "book.yml": `title: "FM"
date_format: "YYYY.MM.DD"
frontmatter:
  title_as_heading: true
  meta: [authors, modified, tags]
  labels: { modified: "更新" }
structure:
  - type: chapter
    path: notes/01-with-h1.md
  - type: chapter
    path: notes/02-no-h1.md
    cover:
      background: "#25304a"
      color: "#ffffff"
      bleed: true
    running:
      footer:
        center: "{{fm.status}} · {{fm.owner}}"
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
`,
    "notes/01-with-h1.md": `---
authors: [Alice, Bob]
modified: 2026-07-11
tags: alpha, beta
---
# 有标题的章

正文。
`,
    "notes/02-no-h1.md": `---
title: "注入的章题"
status: draft
owner: 唐
modified: 2026-07-10
---
没有一级标题的正文。
`
  });

  const result = await runScript("build.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  const html = await readOut(dir, "handout.html");

  // 标准方言剥离 frontmatter：不再泄漏 <hr> + 字面 YAML
  assert.doesNotMatch(html, /authors: \[Alice/);
  assert.doesNotMatch(html, /<h2>title: /);

  // meta band：作者、带标签的日期、标签胶囊
  assert.match(html, /<div class="hb-chapter-meta">/);
  assert.match(html, /Alice, Bob/);
  assert.match(html, /<span class="hb-meta-label">更新<\/span>2026\.07\.11/);
  assert.match(html, /class="hb-tag" data-tag="alpha"/);

  // title_as_heading：fm.title 成为真实 h1（锚点 + 目录行）
  assert.match(html, /<h1 id="注入的章题"[^>]*>注入的章题<\/h1>/);
  assert.match(html, /<a href="#注入的章题">注入的章题<\/a>/);

  // 章节 cover：位于章节 section 之前、带 bleed-before 锚点与背景
  const coverAt = html.indexOf("hb-chapter-cover-1-sec");
  const chapterAt = html.indexOf('data-chapter="2"');
  assert.ok(coverAt !== -1 && coverAt < chapterAt, "cover precedes its chapter");
  assert.match(html, /data-hb-bleed-before="注入的章题"/);
  assert.match(html, /<p class="hb-divider-title">注入的章题<\/p>/);
  assert.match(html, /更新 2026\.07\.10/);

  // running fm：占位符在构建期解析进 data-hb-running
  assert.match(html, /data-hb-running="[^"]*draft · 唐/);
});
