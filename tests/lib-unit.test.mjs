// tests/lib-unit.test.mjs — scripts/lib 纯函数的直接单元测试（无子进程）。
// 解析器边界此前只能靠整条流水线间接覆盖；这里毫秒级回归。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { makeFixture } from "./helpers.mjs";

import {
  parseObsidianReference,
  parseObsidianFrontmatter,
  stripObsidianComments,
  scanObsidianReferences,
  obsidianFragmentExists,
  createObsidianVault
} from "../scripts/lib/obsidian.mjs";
import { formatDate, marginParts, pageHeightMm, sanitizeCssValue } from "../scripts/lib/util.mjs";
import { buildToc, buildChapterToc } from "../scripts/lib/toc.mjs";
import { buildOverrideCss } from "../scripts/lib/css.mjs";
import { normalizeChapterEntry, normalizeChapters } from "../scripts/lib/chapters.mjs";
import { dividerSectionHtml, blankSectionHtml } from "../scripts/lib/special-pages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("book.schema.json parses and every local $ref resolves", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "book.schema.json"), "utf8"));
  const refs = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) refs.push(value.$ref);
    for (const child of Object.values(value)) visit(child);
  };
  visit(schema);

  for (const ref of refs) {
    const target = ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((value, part) => value?.[part], schema);
    assert.notEqual(target, undefined, `unresolved schema ref: ${ref}`);
  }
  assert.ok(refs.length > 0, "schema should contain local references");
});

test("book.example.yml parses and its active CSS class options are valid", () => {
  const example = parseYaml(fs.readFileSync(path.join(repoRoot, "book.example.yml"), "utf8"));
  assert.equal(typeof example.title, "string");
  assert.ok(Array.isArray(example.chapters) !== Array.isArray(example.structure));
  for (const value of [example.chapter_toc?.class]) {
    if (value === undefined) continue;
    assert.match(value, /^[A-Za-z_-][A-Za-z0-9_-]*(?:\s+[A-Za-z_-][A-Za-z0-9_-]*)*$/);
  }
});

test("parseObsidianReference: targets, fragments, aliases, embed sizes", () => {
  assert.deepEqual(
    (({ target, fragment, alias }) => ({ target, fragment, alias }))(
      parseObsidianReference("Note#Heading|shown")
    ),
    { target: "Note", fragment: "Heading", alias: "shown" }
  );
  // 表格里的 \| 仍是别名分隔符
  assert.equal(parseObsidianReference("Note\\|alias").alias, "alias");
  assert.equal(parseObsidianReference("Note#^block-1").fragment, "^block-1");
  const sized = parseObsidianReference("pic.png|64x32", { embed: true });
  assert.equal(sized.width, 64);
  assert.equal(sized.height, 32);
  assert.equal(parseObsidianReference("pic.png|640", { embed: true }).width, 640);
  // 非嵌入语境下 |640 是别名不是尺寸
  assert.equal(parseObsidianReference("Note|640").width, null);
});

test("parseObsidianFrontmatter: normal, empty form, offsets, and errors", () => {
  const normal = parseObsidianFrontmatter("---\na: 1\nb: x\n---\nBody\n");
  assert.deepEqual(normal.data, { a: 1, b: "x" });
  assert.equal(normal.body, "Body\n");
  assert.equal(normal.lineOffset, 4);
  assert.equal(normal.error, null);

  // Obsidian 删光属性后写出的空 frontmatter：必须识别并吞掉
  const empty = parseObsidianFrontmatter("---\n---\n# H\n");
  assert.deepEqual(empty.data, {});
  assert.equal(empty.body, "# H\n");
  assert.equal(empty.error, null);

  // 不在首行的 --- 不是 frontmatter
  const notFm = parseObsidianFrontmatter("intro\n---\na: 1\n---\n");
  assert.deepEqual(notFm.data, {});
  assert.equal(notFm.lineOffset, 0);

  // YAML 错误：报错但正文照常剥离
  const bad = parseObsidianFrontmatter("---\na: [1\n---\nBody\n");
  assert.deepEqual(bad.data, {});
  assert.ok(bad.error);
  assert.equal(bad.body, "Body\n");

  // 顶层是序列而不是映射
  const seq = parseObsidianFrontmatter("---\n- a\n- b\n---\nBody\n");
  assert.match(seq.error ?? "", /mapping/);

  // CRLF
  const crlf = parseObsidianFrontmatter("---\r\na: 1\r\n---\r\nBody\r\n");
  assert.deepEqual(crlf.data, { a: 1 });
});

test("stripObsidianComments: comments removed, code shielded, newlines stable", () => {
  const source = [
    "before %%gone%% after",
    "`%%literal%%` stays",
    "%%",
    "block gone",
    "%%",
    "`````outer",
    "```",
    "%%not a comment in a fence%%",
    "`````",
    "tail"
  ].join("\n");
  const clean = stripObsidianComments(source);
  assert.doesNotMatch(clean, /gone/);
  assert.match(clean, /%%literal%%/);
  assert.match(clean, /%%not a comment in a fence%%/);
  // 行数保持稳定（诊断行号依赖它）
  assert.equal(clean.split("\n").length, source.split("\n").length);
});

test("scanObsidianReferences: fences and inline code shield links; line numbers exact", () => {
  const source = [
    "# H", // 1
    "", // 2
    "[[Real Target]]", // 3
    "", // 4
    "```", // 5
    "[[in fence — not a link]]", // 6
    "```", // 7
    "`[[inline code — not a link]]` and ![[Embed Me]]" // 8
  ].join("\n");
  const refs = scanObsidianReferences(source);
  assert.deepEqual(
    refs.map((r) => ({ target: r.target, line: r.line, embed: r.embed })),
    [
      { target: "Real Target", line: 3, embed: false },
      { target: "Embed Me", line: 8, embed: true }
    ]
  );
});

test("scanObsidianReferences: frontmatter values cannot poison the body scan", () => {
  const source = "---\ndiscount: 50%% off\ncmd: a` tick\nrelated: \"[[In FM]]\"\n---\n# H\n\n[[In Body]]\n";
  const refs = scanObsidianReferences(source, { includeFrontmatter: true });
  const targets = refs.map((r) => `${r.target}@${r.line}`);
  assert.ok(targets.includes("In FM@4"), `frontmatter link scanned: ${targets}`);
  // 正文链接在第 8 行且没有被 %%/反引号状态吞掉
  assert.ok(targets.includes("In Body@8"), `body link survives: ${targets}`);
});

test("vault resolve: exact path, stem, alias (incl. comma form), nearest-dir ranking", async () => {
  const dir = await makeFixture({
    "notes/a.md": "---\naliases: One, Two\n---\n# A\n",
    "notes/x/b.md": "# B\n",
    "notes/y/b.md": "# B elsewhere\n",
    "other/c.md": "# C far away\n",
    "notes/near/c.md": "# C nearby\n"
  });
  const vault = createObsidianVault(dir);
  const from = `${dir}/notes/a.md`;

  assert.equal(vault.resolve("notes/x/b.md", from)?.file.relPath, "notes/x/b.md");
  assert.equal(vault.resolve("a", from)?.file.relPath, "notes/a.md");
  // 逗号分隔的 aliases 标量按 Obsidian 规则拆分后参与解析
  assert.equal(vault.resolve("One", from)?.file.relPath, "notes/a.md");
  assert.equal(vault.resolve("Two", from)?.file.relPath, "notes/a.md");
  // 距离不同：最近目录直接胜出，无歧义
  const near = vault.resolve("c", from);
  assert.equal(near?.file.relPath, "notes/near/c.md");
  assert.equal(near?.ambiguous.length, 0);
  // 等距歧义：字典序靠前者胜出，其余进入 ambiguous 报告
  const tied = vault.resolve("b", from);
  assert.equal(tied?.file.relPath, "notes/x/b.md");
  assert.equal(tied?.ambiguous.length, 1);
  assert.equal(vault.resolve("missing", from), null);
});

test("obsidianFragmentExists: headings, nested paths, blocks; fences shielded", async () => {
  const dir = await makeFixture({
    "n.md": [
      "# Top",
      "## Section",
      "### Deep",
      "",
      "Fact. ^fact-1",
      "",
      "```",
      "## Fenced Heading",
      "```"
    ].join("\n")
  });
  const file = `${dir}/n.md`;
  assert.equal(obsidianFragmentExists(file, "Section"), true);
  assert.equal(obsidianFragmentExists(file, "Section#Deep"), true);
  assert.equal(obsidianFragmentExists(file, "^fact-1"), true);
  assert.equal(obsidianFragmentExists(file, "Fenced Heading"), false);
  assert.equal(obsidianFragmentExists(file, "Missing"), false);
});

test("util: formatDate presets, marginParts shorthand, pageHeightMm, css sanitizing", () => {
  assert.equal(formatDate("2026-07-11", "YYYY.MM.DD"), "2026.07.11");
  assert.equal(formatDate("2026-07-11", "yymmdd"), "260711");
  assert.equal(formatDate("not a date", "YYYY"), "not a date");

  assert.deepEqual(marginParts("10mm 20mm"), {
    top: "10mm",
    right: "20mm",
    bottom: "10mm",
    left: "20mm"
  });

  assert.equal(pageHeightMm("A4"), 297);
  assert.equal(pageHeightMm("A4 landscape"), 210);
  assert.equal(pageHeightMm("letter"), 279.4);
  assert.equal(pageHeightMm("210mm 297mm"), 297);
  assert.equal(pageHeightMm("unknown-size"), 297);

  assert.equal(sanitizeCssValue("red; } body { color: blue"), "red  body  color: blue");
});

test("toc builders: level jumps stay balanced; chapter toc filters by depth", () => {
  const toc = buildToc(
    [
      { level: 1, id: "a", title: "A" },
      { level: 3, id: "b", title: "B" }, // h1 → h3 跳级按 +1 层处理
      { level: 1, id: "c", title: "C" }
    ],
    { enabled: true, title: "目录", depth: 3 }
  );
  assert.equal((toc.match(/<ol/g) ?? []).length, (toc.match(/<\/ol>/g) ?? []).length);
  assert.match(toc, /data-target="b"/);

  const mini = buildChapterToc(
    [
      { level: 2, id: "s1", title: "S1" },
      { level: 4, id: "deep", title: "Deep" }
    ],
    { title: "本章", depth: 3, className: "" }
  );
  assert.match(mini, /data-target="s1"/);
  assert.doesNotMatch(mini, /data-target="deep"/); // depth 3 过滤 h4
});

test("chapters entries: path roles, declared special pages, and strict typos", () => {
  // 字符串与既有对象形态不变
  assert.equal(normalizeChapterEntry("notes/a.md").kind, "chapter");
  assert.equal(normalizeChapterEntry("notes/p.html").kind, "insert");
  assert.equal(normalizeChapterEntry({ path: "notes/a.md", chapter_toc: true }).chapterToc, true);

  // as 覆盖角色；.html 不能当章节
  const mdInsert = normalizeChapterEntry({ path: "front/preface.md", as: "insert" });
  assert.equal(mdInsert.kind, "insert");
  assert.equal(mdInsert.format, "markdown");
  assert.match(
    normalizeChapterEntry({ path: "front/preface.md", role: "insert", as: "insert" }).error ?? "",
    /either "role".*"as"/
  );
  assert.match(normalizeChapterEntry({ path: "p.html", as: "chapter" }).error ?? "", /cannot be "as: chapter"/);

  // 每条目主目录控制
  assert.equal(normalizeChapterEntry({ path: "a.md", toc: false }).toc, false);
  assert.equal(normalizeChapterEntry({ path: "a.md", toc: "附录 A" }).toc, "附录 A");
  assert.match(normalizeChapterEntry({ path: "a.md", toc: 3 }).error ?? "", /"toc" must be/);

  // 声明式特殊页
  const divider = normalizeChapterEntry({
    divider: { title: "第一部分", subtitle: "Basics", bleed: true, toc: "第一部分" }
  });
  assert.equal(divider.kind, "divider");
  assert.equal(divider.bleed, true);
  assert.match(normalizeChapterEntry({ divider: { bleed: true } }).error ?? "", /requires a "title"/);
  assert.match(normalizeChapterEntry({ divider: { title: "T", oops: 1 } }).error ?? "", /unknown key/);

  assert.deepEqual(normalizeChapterEntry({ blank: true }), { kind: "blank", count: 1 });
  assert.equal(normalizeChapterEntry({ blank: 3 }).count, 3);
  assert.match(normalizeChapterEntry({ blank: 0 }).error ?? "", /blank entry/);

  assert.equal(normalizeChapterEntry({ contents: true }).kind, "contents");
  assert.match(normalizeChapterEntry({ contents: "yes" }).error ?? "", /contents: true/);

  // 拼错的类型键不落入路径解释
  assert.match(normalizeChapterEntry({ divder: { title: "T" } }).error ?? "", /exactly one of/);
  assert.match(normalizeChapterEntry({ path: "a.md", divider: {} }).error ?? "", /exactly one of/);
  assert.match(normalizeChapterEntry({ path: "a.md", oops: 1 }).error ?? "", /unknown key/);

  // 列表级约束：contents 至多一次、至少一个实体页
  const onlyDeclared = normalizeChapters({ chapters: [{ blank: true }] }, "/tmp");
  assert.match(onlyDeclared.error ?? "", /at least one \.md or \.html/);
  const twoContents = normalizeChapters(
    { chapters: ["a.md", { contents: true }, { contents: true }] },
    "/tmp"
  );
  assert.match(twoContents.error ?? "", /at most once/);
});

test("structure IR: named layouts, part inheritance, navigation levels, and explicit types", () => {
  const result = normalizeChapters(
    {
      layouts: {
        body: { class: "layout-body", chapter_toc: true },
        compact: {
          extends: "body",
          class: "layout-compact",
          flow: { break_before: "auto", break_after: "page" }
        }
      },
      structure: [
        {
          type: "part",
          title: "Part One",
          navigation: { label: "I · Part One", level: 1 },
          defaults: { layout: "compact" },
          children: [
            { type: "chapter", path: "notes/a.md" },
            {
              type: "chapter",
              path: "notes/b.md",
              navigation: { toc: false, outline: false }
            }
          ]
        }
      ]
    },
    "/tmp"
  );

  assert.equal(result.error, undefined, result.errors?.join("\n"));
  assert.equal(result.entries.length, 3);
  const [part, first, second] = result.entries;
  assert.equal(part.kind, "divider");
  assert.equal(part.toc, "I · Part One");
  assert.equal(first.kind, "chapter");
  assert.equal(first.layout, "compact");
  assert.equal(first.className, "layout-body layout-compact");
  assert.equal(first.chapterToc, true);
  assert.deepEqual(first.flow, { breakBefore: "auto", breakAfter: "page" });
  assert.equal(first.navigation.level, 2);
  assert.equal(second.navigation.toc, false);
  assert.equal(second.navigation.outline, false);
});

test("structure IR: running header/footer slots and style inherit field by field", () => {
  const result = normalizeChapters(
    {
      layouts: {
        runningBase: {
          running: {
            header: { left: "Base left", center: "Base center" },
            footer: { left: "Base footer", center: "{{page}} / {{total}}" },
            style: { color: "#555", font_size: "8px" }
          }
        },
        runningChild: {
          extends: "runningBase",
          running: {
            header: { right: "Child right" },
            footer: { right: "{{chapterTitle}}" },
            style: { color: "#246" }
          }
        }
      },
      structure: [
        {
          type: "chapter",
          path: "notes/a.md",
          layout: "runningChild",
          running: { footer: { left: "Chapter footer" } }
        }
      ]
    },
    "/tmp"
  );

  assert.equal(result.error, undefined, result.errors?.join("\n"));
  assert.deepEqual(result.entries[0].running, {
    header: { left: "Base left", center: "Base center", right: "Child right" },
    footer: {
      left: "Chapter footer",
      center: "{{page}} / {{total}}",
      right: "{{chapterTitle}}"
    },
    style: { color: "#246", font_size: "8px" },
    headerSet: true,
    footerSet: true,
    styleSet: true,
    custom: true
  });

  const sharedPage = normalizeChapters(
    {
      structure: [
        { path: "notes/a.md", running: { footer: { left: "A" } } },
        { path: "notes/b.md", flow: { break_before: "auto" } }
      ]
    },
    "/tmp"
  );
  assert.match(sharedPage.errors.join("\n"), /cannot share a physical page/);
});

test("structure IR: layout cycles and structure/chapters ambiguity are hard errors", () => {
  const cycle = normalizeChapters(
    {
      layouts: { a: { extends: "b" }, b: { extends: "a" } },
      structure: [{ type: "chapter", path: "notes/a.md", layout: "a" }]
    },
    "/tmp"
  );
  assert.match(cycle.errors.join("\n"), /layout inheritance cycle/);

  const ambiguous = normalizeChapters(
    { chapters: ["a.md"], structure: ["b.md"] },
    "/tmp"
  );
  assert.match(ambiguous.error ?? "", /either "structure" or "chapters"/);

  const ambiguousPart = normalizeChapters(
    {
      structure: [
        {
          type: "part",
          title: "P",
          children: [{ path: "a.md" }],
          chapters: [{ path: "b.md" }]
        }
      ]
    },
    "/tmp"
  );
  assert.match(ambiguousPart.errors.join("\n"), /exactly one of children \/ chapters \/ structure/);
});

test("special pages: divider html carries heading id, bleed hook, sanitized style", () => {
  const html = dividerSectionHtml(
    {
      title: "第一部分",
      subtitle: "Basics",
      note: "",
      className: "part-one",
      background: "linear-gradient(145deg, #111, #222)",
      color: "#fff",
      bleed: true
    },
    { headingId: "hb-divider-1", lead: "" }
  );
  assert.match(html, /<section class="insert hb-divider part-one" id="hb-divider-1-sec" data-hb-bleed="hb-divider-1"/);
  assert.match(html, /<h1 class="hb-divider-title" id="hb-divider-1"[^>]*>第一部分<\/h1>/);
  assert.match(html, /background: linear-gradient\(145deg, #111, #222\)/);
  assert.doesNotMatch(html, /data-hb-bleed=""/);

  assert.match(blankSectionHtml(), /class="insert hb-blank" aria-hidden="true"/);
});

test("css: override block mirrors margins, emits page height, restores :first", () => {
  const css = buildOverrideCss({
    styleCfg: { accent_color: "#123456" },
    pdfCfg: { page_size: "A4", margin: "17mm 16mm 19mm 16mm" },
    coverCfg: {},
    backCfg: {},
    coverEnabled: false,
    coverUsesHeaderFooter: false
  });
  assert.match(css, /--hb-accent: #123456;/);
  assert.match(css, /--hb-page-margin-top: 17mm;/);
  assert.match(css, /--hb-page-height: 297mm;/);
  assert.match(css, /@page \{\n {2}size: A4;\n {2}margin: 17mm 16mm 19mm 16mm;\n\}/);
  // 无封面：第一页恢复正常边距
  assert.match(css, /@page :first \{\n {2}margin: 17mm 16mm 19mm 16mm;\n\}/);
});

test("frontmatter context: derived keys, dates, lists, placeholders", async () => {
  const { frontmatterContext, resolveFmPlaceholders } = await import("../scripts/lib/frontmatter.mjs");
  const fm = frontmatterContext(
    {
      title: "章题",
      author: "唐",
      created: "2026-07-01",
      updated: "2026-07-11",
      tags: "a, b/c, #d",
      status: "draft",
      rating: 5,
      done: true
    },
    { dateFormat: "YYYY.MM.DD" }
  );
  assert.equal(fm.derived.title, "章题");
  assert.deepEqual(fm.derived.authorsList, ["唐"]);
  assert.equal(fm.derived.created, "2026.07.01");
  assert.equal(fm.derived.modified, "2026.07.11"); // updated 别名
  assert.deepEqual(fm.derived.tagsList, ["a", "b/c", "d"]); // 逗号拆分 + 去 #
  assert.equal(fm.values.rating, "5");
  assert.equal(fm.values.done, "true");
  assert.equal(fm.values.author, "唐");
  assert.equal(fm.values.modified, "2026.07.11");

  const warned = [];
  const out = resolveFmPlaceholders(
    "{{fm.status}} · {{frontmatter.modified}} · {{fm.missing}} · {{page}}",
    fm.values,
    { warn: (m) => warned.push(m) }
  );
  assert.equal(out, "draft · 2026.07.11 ·  · {{page}}"); // 其余占位符原样保留
  assert.equal(warned.length, 1);
  assert.match(warned[0], /"missing"/);
});

test("chapters entries: v3 meta and cover keys normalize and validate", () => {
  const withMeta = normalizeChapterEntry({ path: "a.md", meta: ["authors", "modified"] });
  assert.deepEqual(withMeta.meta, ["authors", "modified"]);
  assert.equal(normalizeChapterEntry({ path: "a.md", meta: false }).meta, false);
  assert.match(normalizeChapterEntry({ path: "a.md", meta: [""] }).error ?? "", /non-empty/);

  const withCover = normalizeChapterEntry({
    path: "a.md",
    cover: { background: "#123", bleed: true, meta: ["更新 {{fm.modified}}"] }
  });
  assert.equal(withCover.cover.enabled, true);
  assert.equal(withCover.cover.bleed, true);
  assert.deepEqual(withCover.cover.metaLines, ["更新 {{fm.modified}}"]);
  assert.equal(normalizeChapterEntry({ path: "a.md", cover: false }).cover, null);
  assert.match(normalizeChapterEntry({ path: "p.html", cover: true }).error ?? "", /Markdown page/);
  assert.match(
    normalizeChapterEntry({ path: "a.md", as: "insert", cover: true }).error ?? "",
    /chapters only/
  );
  assert.match(
    normalizeChapterEntry({ path: "a.md", cover: { oops: 1 } }).error ?? "",
    /unknown key/
  );
});
