#!/usr/bin/env node
/** Print the normalized document structure without rendering HTML or PDF. */

import path from "node:path";

import { normalizeChapters } from "./lib/chapters.mjs";
import { resolveConfigPath, loadBook } from "./lib/config.mjs";
import { toPosix } from "./lib/util.mjs";

const configPath = resolveConfigPath();
const baseDir = path.dirname(configPath);
const book = loadBook(configPath);
const result = normalizeChapters(book, baseDir);

if (result.errors?.length) {
  for (const message of result.errors) console.error(`Error: ${message}`);
  process.exit(1);
}

const rows = result.entries.map((entry, index) => ({
  index: index + 1,
  type: entry.kind,
  role: entry.role ?? entry.kind,
  layout: entry.layout || "-",
  before: entry.flow?.breakBefore ?? "page",
  after: entry.flow?.breakAfter ?? "auto",
  toc:
    entry.kind === "contents"
      ? "-"
      : entry.toc === false || entry.navigation?.toc === false
        ? "no"
        : entry.toc || entry.navigation?.label || "yes",
  outline: entry.navigation?.outline === false ? "no" : "yes",
  running:
    `${entry.running?.header === false ? "-H" : typeof entry.running?.header === "object" ? "*H" : "+H"}` +
    `/${entry.running?.footer === false ? "-F" : typeof entry.running?.footer === "object" ? "*F" : "+F"}` +
    `${Object.keys(entry.running?.style ?? {}).length ? "/S" : ""}`,
  source: entry.file ? toPosix(entry.file) : entry.title || "-"
}));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ source: result.key, entries: rows }, null, 2)}\n`);
  process.exit(0);
}

const headers = [
  "#", "TYPE", "ROLE", "LAYOUT", "BEFORE", "AFTER", "TOC", "OUTLINE", "RUNNING", "SOURCE"
];
const values = rows.map((row) => [
  row.index,
  row.type,
  row.role,
  row.layout,
  row.before,
  row.after,
  row.toc,
  row.outline,
  row.running,
  row.source
]);
const widths = headers.map((header, column) =>
  Math.max(header.length, ...values.map((row) => String(row[column]).length))
);
const line = (row) =>
  row.map((value, column) => String(value).padEnd(widths[column])).join("  ").trimEnd();

console.log(`Document structure (${rows.length} entries, source: ${result.key})`);
console.log(line(headers));
console.log(line(widths.map((width) => "-".repeat(width))));
for (const row of values) console.log(line(row));
