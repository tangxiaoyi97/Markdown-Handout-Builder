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
