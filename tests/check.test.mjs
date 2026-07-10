// tests/check.test.mjs — scripts/check.mjs 的正/负例回归。

import test from "node:test";
import assert from "node:assert/strict";
import { makeFixture, runScript, baseBook, ALPHA_MD, BETA_MD, TINY_PNG } from "./helpers.mjs";

const MINI_BOOK = `title: "T"
chapters:
  - notes/a.md
`;

test("valid project passes with 'Check passed'", async () => {
  const dir = await makeFixture({
    "book.yml": baseBook(),
    "notes/01-alpha.md": ALPHA_MD,
    "notes/02-beta.md": BETA_MD,
    "notes/assets/p.png": TINY_PNG
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Check passed/);
});

test("missing chapter file fails", async () => {
  const dir = await makeFixture({ "book.yml": MINI_BOOK });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /chapter file not found/);
});

test("wikilink and embed are rejected", async () => {
  const dir = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": "# A\n\nSee [[Other Note]] and ![[pic.png]].\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /embed/);
});

test("missing local image fails; remote image passes", async () => {
  const bad = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": "# A\n\n![x](./assets/nope.png)\n"
  });
  const r1 = await runScript("check.mjs", { cwd: bad });
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /image not found/);

  const ok = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": "# A\n\n![x](https://example.com/x.png)\n"
  });
  const r2 = await runScript("check.mjs", { cwd: ok });
  assert.equal(r2.code, 0, r2.stderr);
});

test("[[ ]] inside code fences and inline code is allowed", async () => {
  const dir = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": "# A\n\n```bash\nif [[ -f x ]]; then echo ok; fi\n```\n\nInline `[[code]]` too.\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
});

test("duplicate chapter entry fails", async () => {
  const dir = await makeFixture({
    "book.yml": 'title: "T"\nchapters:\n  - notes/a.md\n  - notes/a.md\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /more than once/);
});

test("theme validation: bad name, duplicates, multiple defaults", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/a.md]\n' +
      'themes:\n  - name: "bad name!"\n    default: true\n  - name: dup\n  - name: dup\n    default: true\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must match/);
  assert.match(r.stderr, /duplicate theme name/);
  assert.match(r.stderr, /only one theme/);
});

test("pdf config validation: bad boolean fails, unknown placeholder and slot warn", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/a.md]\n' +
      'pdf:\n  page_numbers:\n    count_cover: "yes"\n  header:\n    left: "{{titel}}"\n    middle: "oops"\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /must be true or false/);
  assert.match(r.stderr, /unknown placeholder \{\{titel\}\}/);
  assert.match(r.stderr, /unknown slot/);
});

test("warnings: orphan chapters reported, _drafts skipped, unused assets reported", async () => {
  const dir = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": "# A\n",
    "notes/02-forgotten.md": "# Forgotten\n",
    "notes/_wip.md": "# Draft\n",
    "notes/assets/unused.png": TINY_PNG
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /02-forgotten\.md: not listed/);
  assert.doesNotMatch(r.stderr, /_wip\.md/);
  assert.match(r.stderr, /unused\.png: not referenced/);
});

test("UTF-8 BOM chapter passes", async () => {
  const dir = await makeFixture({
    "book.yml": MINI_BOOK,
    "notes/a.md": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# A\n\ntext\n")])
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
});

test("non-scalar version fails", async () => {
  const dir = await makeFixture({
    "book.yml": 'title: "T"\nversion: [2, 1]\nchapters: [notes/a.md]\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /"version" must be a string or number/);
});

test("chapters: unrecognized extension fails; .html insert is accepted", async () => {
  const bad = await makeFixture({
    "book.yml": "title: T\nchapters:\n  - notes/a.txt\n",
    "notes/a.txt": "x"
  });
  const r1 = await runScript("check.mjs", { cwd: bad });
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /unrecognized extension/);

  const ok = await makeFixture({
    "book.yml": "title: T\nchapters:\n  - notes/a.md\n  - notes/p.html\n",
    "notes/a.md": "# A\n",
    "notes/p.html": "<p>hi</p>"
  });
  const r2 = await runScript("check.mjs", { cwd: ok });
  assert.equal(r2.code, 0, r2.stderr);
});

test("external chapters file: valid passes; missing fails; a non-yaml string fails", async () => {
  const ok = await makeFixture({
    "book.yml": "title: T\nchapters: chapters.yml\n",
    "chapters.yml": "- notes/a.md\n",
    "notes/a.md": "# A\n"
  });
  assert.equal((await runScript("check.mjs", { cwd: ok })).code, 0);

  const missing = await makeFixture({ "book.yml": "title: T\nchapters: nope.yml\n" });
  const rm = await runScript("check.mjs", { cwd: missing });
  assert.equal(rm.code, 1);
  assert.match(rm.stderr, /chapters file not found/);

  const notYaml = await makeFixture({
    "book.yml": "title: T\nchapters: notes/a.md\n",
    "notes/a.md": "# A\n"
  });
  const rn = await runScript("check.mjs", { cwd: notYaml });
  assert.equal(rn.code, 1);
  assert.match(rn.stderr, /must point to a \.yml/);
});

test("chapters object form + chapter_toc config: class, depth, default, count_toc, insert warning", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters:\n" +
      '  - path: notes/a.md\n    class: "bad class!"\n' +
      "  - path: notes/x.html\n    chapter_toc: true\n" +
      'chapter_toc:\n  depth: 9\n  default: "yes"\n' +
      'pdf:\n  page_numbers:\n    count_toc: "x"\n',
    "notes/a.md": "# A\n",
    "notes/x.html": "<p>hi</p>"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /invalid class/);
  assert.match(r.stderr, /chapter_toc\.depth must be an integer between 2 and 6/);
  assert.match(r.stderr, /chapter_toc\.default must be true or false/);
  assert.match(r.stderr, /count_toc must be true or false/);
  assert.match(r.stderr, /chapter_toc is ignored on a \.html insert/);
});

test("missing custom_css and cover component fail", async () => {
  const dir = await makeFixture({
    "book.yml":
      'title: "T"\nchapters: [notes/a.md]\n' +
      'style:\n  custom_css: "templates/nope.css"\ncover:\n  html: "templates/nope.html"\n',
    "notes/a.md": "# A\n"
  });
  const r = await runScript("check.mjs", { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /custom_css file not found/);
  assert.match(r.stderr, /component not found/);
});

test("Obsidian dialect accepts resolved wikilinks and embeds", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md": "# A\n\nSee ![[b#Part]] and ![[assets/p.png|80]].\n",
    "notes/b.md": "# B\n\n## Part\n\nText.\n",
    "notes/assets/p.png": TINY_PNG
  });
  const result = await runScript("check.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /unsupported/);
  assert.doesNotMatch(result.stderr, /unused asset/);
  assert.doesNotMatch(result.stderr, /notes\/b\.md: not listed/);
});

test("Obsidian dialect reports missing targets and invalid options", async () => {
  const missing = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md": "# A\n\n[[Missing note]]\n"
  });
  const missingResult = await runScript("check.mjs", { cwd: missing });
  assert.equal(missingResult.code, 1);
  assert.match(missingResult.stderr, /target not found: Missing note/);

  const invalid = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n  obsidian:\n    properties: sometimes\n",
    "notes/a.md": "# A\n"
  });
  const invalidResult = await runScript("check.mjs", { cwd: invalid });
  assert.equal(invalidResult.code, 1);
  assert.match(invalidResult.stderr, /properties must be/);
});

test("Obsidian frontmatter values cannot poison link validation", async () => {
  // A "%%" or an unpaired backtick inside a YAML value used to leak comment /
  // code-span state into the body scan, silently skipping every wikilink.
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md":
      "---\ndiscount: 50%% off\ncmd: a` tick\n---\n# A\n\n[[Missing note]]\n"
  });
  const result = await runScript("check.mjs", { cwd: dir });
  assert.equal(result.code, 1);
  // Line number stays exact despite the frontmatter (the link is on file line 7).
  assert.match(result.stderr, /notes\/a\.md:7: Obsidian link target not found: Missing note/);
});

test("Obsidian dialect validates heading and block fragments", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md": "# A\n\n[[b#Missing heading]] and ![[b#^missing-block]].\n",
    "notes/b.md": "# B\n\n## Existing\n\nParagraph. ^existing-block\n"
  });
  const result = await runScript("check.mjs", { cwd: dir });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /fragment not found: notes\/b\.md#Missing heading/);
  assert.match(result.stderr, /fragment not found: notes\/b\.md#\^missing-block/);
});

test("Obsidian reference checks ignore comments, fences, and multiline code spans", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md": `# A

%% [[Missing in comment]] %%

\`multiline code
[[Missing in code]]
still code\`

\`\`\`md
![[Missing in fence]]
\`\`\`
`
  });
  const result = await runScript("check.mjs", { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
});

test("Obsidian checks recurse through transcluded notes", async () => {
  const dir = await makeFixture({
    "book.yml":
      "title: T\nchapters: [notes/a.md]\nmarkdown:\n  dialect: obsidian\n",
    "notes/a.md": "# A\n\n![[b]]\n",
    "notes/b.md": "# B\n\n![[Missing nested note]]\n"
  });
  const result = await runScript("check.mjs", { cwd: dir });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /notes\/b\.md:3: Obsidian embed target not found/);
});
