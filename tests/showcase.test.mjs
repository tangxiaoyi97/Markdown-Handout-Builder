// tests/showcase.test.mjs — showcase/obsidian 作为黄金夹具：
// 真实 vault（transclusion、properties、callouts、Mermaid、CJK、附件）
// 跑完整 check + build，并断言结构不变量。PDF 级验证由 CI（render.yml）
// 与 tests/pdf.test.mjs 的合成夹具覆盖，这里保持秒级。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolRoot, runScript, readOut, outExists } from "./helpers.mjs";

async function makeShowcaseFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mhb-showcase-"));
  await fs.cp(path.join(toolRoot, "showcase", "obsidian"), dir, { recursive: true });
  // 输出改到夹具内部（仓库里的 book.yml 指向 ../../dist/showcase/）
  const bookPath = path.join(dir, "book.yml");
  const book = (await fs.readFile(bookPath, "utf8"))
    .replace("../../dist/showcase/obsidian-syntax-showcase.html", "dist/showcase.html")
    .replace("../../dist/showcase/obsidian-syntax-showcase.pdf", "dist/showcase.pdf");
  await fs.writeFile(bookPath, book);
  return dir;
}

test("obsidian showcase vault: check passes and build asserts structural invariants", async () => {
  const dir = await makeShowcaseFixture();

  const check = await runScript("check.mjs", { cwd: dir });
  assert.equal(check.code, 0, check.stderr);
  assert.match(check.stdout, /Check passed/);

  const build = await runScript("build.mjs", { cwd: dir });
  assert.equal(build.code, 0, build.stderr);
  // 真实 vault 构建必须零警告（未解析链接/图片会在这里现形）
  assert.doesNotMatch(build.stderr, /Warning:/);

  const html = await readOut(dir, "showcase.html");

  // 章节与 properties：7 章各带一个 properties 块
  // （匹配 <section> 标签而不是裸 data-chapter=，内联 CSS 里有同名选择器）
  assert.equal((html.match(/<section class="chapter/g) ?? []).length, 7);
  assert.equal((html.match(/<dl class="obsidian-properties"/g) ?? []).length, 7);

  // Properties UI 保真：标签 pill 不带 #，多值 aliases 是独立 value
  assert.match(html, /data-tag="obsidian\/markdown">obsidian\/markdown</);
  assert.match(
    html,
    /<span class="obsidian-property-value">Start Here<\/span><span class="obsidian-property-value">OFM Showcase<\/span>/
  );

  // 内联标签保留 #（与正文语义一致）
  assert.match(html, /class="obsidian-tag" data-tag="showcase">#showcase</);

  // 多级标题链接落到正主（chapter 07），而不是 transclusion 副本
  assert.match(html, /href="#nested-section-2"[^>]*data-href="Reference Library#Canonical Heading#Nested Section"/);

  // transclusion 标题降级（不进 PDF 书签），且脚注不重复
  assert.equal((html.match(/<h[1-6] role="paragraph"/g) ?? []).length, 5);
  assert.equal((html.match(/id="fn-ch4-embed1-1"/g) ?? []).length, 1);

  // callout 标题里没有被拼进脚注区
  assert.doesNotMatch(html, /callout-title">[^<]*<hr class="footnotes-sep"/);

  // 链接全部解析（出现 unresolved 即回归）
  assert.doesNotMatch(html, /class="[^"]*\bunresolved\b/);

  // 任务状态语义：勾选仅限完成/取消，自定义状态保留 data-task
  assert.match(html, /data-task="\?"/);
  assert.match(html, /data-task="!"/);
  assert.doesNotMatch(html, /<input[^>]*checked[^>]*data-task="\?"/);

  // Mermaid：两张图 + 运行时资产就位
  assert.equal((html.match(/<pre class="mermaid">/g) ?? []).length, 2);
  assert.ok(await outExists(dir, "assets/mermaid.min.js"));

  // 附件复制到 vault/
  assert.ok(await outExists(dir, "vault/attachments/obsidian-pipeline.svg"));
  assert.ok(await outExists(dir, "vault/attachments/reference-card.pdf"));
});
