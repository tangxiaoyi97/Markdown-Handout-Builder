// tests/helpers.mjs — shared utilities for the test suite (node:test).

import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every test file runs in its own node:test worker process. Keep fixtures for
// the duration of that worker, then remove only the directories created by
// this helper. Without this, repeated release verification leaks gigabytes of
// copied KaTeX/Mermaid assets into the system temp directory.
const fixtureDirs = new Set();
process.once("exit", () => {
  for (const dir of fixtureDirs) {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Process shutdown: the OS temp cleaner remains the final fallback.
    }
  }
});

/** 1x1 transparent PNG for image fixtures. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Run one of the CLI scripts against a fixture directory.
 * Resolves with { code, stdout, stderr } and never rejects on non-zero exit.
 */
export function runScript(script, { cwd, args = [] } = {}) {
  const scriptPath = path.join(toolRoot, "scripts", script);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, "--config", "book.yml", ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error.code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr)
        });
      }
    );
  });
}

/**
 * Create a temp fixture project from a { "relative/path": content } map.
 * Buffer values are written as-is; strings as UTF-8.
 */
export async function makeFixture(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mhb-test-"));
  fixtureDirs.add(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return dir;
}

export async function readOut(dir, rel) {
  return fs.readFile(path.join(dir, "dist", rel), "utf8");
}

export async function outExists(dir, rel) {
  try {
    await fs.access(path.join(dir, "dist", rel));
    return true;
  } catch {
    return false;
  }
}

/* ---------- PDF inspection (pdfjs-dist, no rendering needed) ---------- */

export async function loadPdf(filePath) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(filePath));
  const task = getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  return {
    doc,
    destroy: () => task.destroy()
  };
}

/** Extract normalized text of a 1-based page. */
export async function pageText(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Flatten the outline tree into a list of titles ("" when absent). */
export async function outlineTitles(doc) {
  const outline = await doc.getOutline();
  if (!outline) return [];
  const titles = [];
  (function walk(items) {
    for (const item of items) {
      titles.push(item.title ?? "");
      if (item.items?.length) walk(item.items);
    }
  })(outline);
  return titles;
}

/* ---------- Common fixture content ---------- */

export function baseBook(extra = "") {
  return `title: "Test Handout"
subtitle: "Suite"
language: "en"
date: "2026-01-02"
date_format: "YYYY.MM.DD"
version: "2.1"
authors:
  - "A"
  - "B"
chapters:
  - notes/01-alpha.md
  - notes/02-beta.md
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
toc:
  title: "Contents"
  depth: 2
${extra}`;
}

export const ALPHA_MD = `# Alpha

==hl== text with math $E=mc^2$ and raw <b>html</b>.

\`\`\`js
const answer = 42;
\`\`\`

![Pic|120](./assets/p.png "Cap 1")

A note.[^1]

[^1]: Footnote one.

::: warning Check units
Units must match.
:::

::: tip
Use SI units.
:::

## Kraft
`;

export const BETA_MD = `# Beta

An [external link](https://example.com/page) here.

Another note.[^1]

[^1]: Footnote two.

## Kraft
`;
