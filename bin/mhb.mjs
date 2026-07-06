#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(binDir, "..");
const require = createRequire(import.meta.url);

const scriptByCommand = {
  check: "check.mjs",
  build: "build.mjs",
  pdf: "render-pdf.mjs",
  "render-pdf": "render-pdf.mjs",
  serve: "serve.mjs"
};

const help = `markdown-handout-builder

Usage:
  mhb <command> [options]

Commands:
  check       Validate book.yml, chapters, and local assets
  build       Render HTML into dist/
  pdf         Render PDF from the generated HTML
  serve       Preview locally and rebuild HTML on save
  all         Run check, build, then pdf
  init        Create a minimal note repository scaffold
  install-browser
              Download Playwright Chromium for PDF rendering
  install-deps
              Install Playwright system dependencies for Linux CI

Options are passed through to the selected command.
Common options:
  --config <file>   Use a config file other than ./book.yml
  --port <number>   Preview port for "mhb serve"
  --force           Overwrite existing files for "mhb init"

Examples:
  mhb init
  mhb check
  mhb build --config book.yml
  mhb serve --port 8001
  mhb install-browser
`;

function printHelp() {
  process.stdout.write(help);
}

function runNodeFile(filePath, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [filePath, ...args], {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} was terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function runScript(command, args) {
  const scriptName = scriptByCommand[command];
  const scriptPath = path.join(toolRoot, "scripts", scriptName);
  return runNodeFile(scriptPath, args, command);
}

function playwrightCliPath() {
  const packagePath = require.resolve("playwright/package.json");
  return path.join(path.dirname(packagePath), "cli.js");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeScaffoldFile(filePath, body, { force }) {
  const exists = await pathExists(filePath);
  if (exists && !force) {
    console.log(`Skipped ${path.relative(process.cwd(), filePath)} (already exists)`);
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  console.log(`${exists ? "Overwrote" : "Created"} ${path.relative(process.cwd(), filePath)}`);
}

async function initProject(args) {
  const force = args.includes("--force");
  // 依赖名与版本从工具自身的 package.json 读取，改名/升级不需要改这里
  const toolPkg = JSON.parse(
    await fs.readFile(path.join(toolRoot, "package.json"), "utf8")
  );
  const projectName = path.basename(process.cwd()) || "My Handout";
  const title = projectName
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

  const book = `title: "${title || "My Handout"}"
subtitle: "Markdown notes to HTML and PDF"
language: "en"
date: "${new Date().toISOString().slice(0, 10)}"
date_format: "YYYY-MM-DD"

authors:
  - "Your Name"

chapters:
  - notes/00-intro.md

output:
  html: dist/handout.html
  pdf: dist/handout.pdf

toc:
  title: "Contents"
  depth: 2

pdf:
  header_footer: true
  toc_page_numbers: true
  cover_header_footer: false
  page_numbers:
    format: "{{page}} / {{total}}"
    count_cover: true
    count_back_cover: true
  header:
    left: "{{title}}"
    center: ""
    right: "{{date}}"
  footer:
    left: ""
    center: "{{page}} / {{total}}"
    right: ""
`;

  const chapter = `# Intro

Start writing your handout here.

## Next steps

1. Edit \`book.yml\` metadata.
2. Add more Markdown files under \`notes/\`.
3. List each chapter in \`book.yml\`.
4. Run \`npm run all\` to build HTML and PDF.
`;

  const pkg = `{
  "private": true,
  "scripts": {
    "check": "mhb check",
    "build": "mhb build",
    "pdf": "mhb pdf",
    "serve": "mhb serve",
    "all": "mhb all",
    "install-browser": "mhb install-browser",
    "install-deps": "mhb install-deps"
  },
  "devDependencies": {
    ${JSON.stringify(toolPkg.name)}: "^${toolPkg.version}"
  }
}
`;

  const gitignore = `node_modules/
dist/*
!dist/.gitkeep
.DS_Store
`;

  // 每个笔记仓库自带 workflow：push 到自己的仓库 → 构建 → 自己的 Pages。
  // Pages 属于仓库而不是这个 npm 包；需在仓库 Settings → Pages 选 GitHub Actions。
  const workflow = `name: Build handout

on:
  push:
    branches: ["main"]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Get Playwright version
        id: playwright-version
        run: echo "version=$(node -e 'process.stdout.write(require("playwright/package.json").version)')" >> "$GITHUB_OUTPUT"

      - name: Cache Playwright Chromium
        id: playwright-cache
        uses: actions/cache@v5
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-\${{ runner.os }}-\${{ steps.playwright-version.outputs.version }}

      - name: Install Playwright Chromium
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install chromium

      - name: Install Playwright system dependencies
        run: npx playwright install-deps chromium

      - name: Install CJK fonts (for Chinese text in the PDF)
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends fonts-noto-cjk

      - run: npm run check
      - run: npm run build
      - run: npm run pdf

      - name: Upload handout artifact
        uses: actions/upload-artifact@v7
        with:
          name: handout
          path: |
            dist/index.html
            dist/handout*.html
            dist/handout*.pdf
          retention-days: 30

      - name: Setup Pages
        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
        uses: actions/configure-pages@v6

      - name: Upload Pages artifact
        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
        uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
`;

  await writeScaffoldFile(path.resolve(process.cwd(), "book.yml"), book, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), "notes", "00-intro.md"), chapter, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), "package.json"), pkg, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), ".gitignore"), gitignore, { force });
  await writeScaffoldFile(
    path.resolve(process.cwd(), ".github", "workflows", "render.yml"),
    workflow,
    { force }
  );
  await writeScaffoldFile(path.resolve(process.cwd(), "dist", ".gitkeep"), "", { force });
  await writeScaffoldFile(path.resolve(process.cwd(), "notes", "assets", ".gitkeep"), "", { force });

  const writingRules = path.join(toolRoot, "WRITING_RULES.md");
  if (await pathExists(writingRules)) {
    const target = path.resolve(process.cwd(), "WRITING_RULES.md");
    if (!(await pathExists(target)) || force) {
      await fs.copyFile(writingRules, target);
      console.log(`Created ${path.relative(process.cwd(), target)}`);
    }
  }

  console.log("");
  console.log("Next:");
  console.log("  npm install");
  console.log("  npm run install-browser");
  console.log("  npm run all");
  console.log("");
  console.log("GitHub Pages: push to GitHub, then in the repository choose");
  console.log("Settings -> Pages -> Source: GitHub Actions. Every push to main");
  console.log("rebuilds and publishes your own Pages site.");
}

async function main() {
  const [rawCommand, ...args] = process.argv.slice(2);
  const command = rawCommand === undefined ? "--help" : rawCommand;

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(toolRoot, "package.json"), "utf8")
      )
    );
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (command === "all") {
    for (const step of ["check", "build", "pdf"]) {
      const code = await runScript(step, args);
      if (code !== 0) return code;
    }
    return 0;
  }

  if (command === "init") {
    await initProject(args);
    return 0;
  }

  if (command === "install-browser") {
    const playwrightArgs = ["install", ...(args.length > 0 ? args : ["chromium"])];
    return runNodeFile(playwrightCliPath(), playwrightArgs, "install-browser");
  }

  if (command === "install-deps") {
    const playwrightArgs = ["install-deps", ...(args.length > 0 ? args : ["chromium"])];
    return runNodeFile(playwrightCliPath(), playwrightArgs, "install-deps");
  }

  if (!Object.hasOwn(scriptByCommand, command)) {
    console.error(`Error: unknown command "${command}".\n`);
    printHelp();
    return 1;
  }

  return runScript(command, args);
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
