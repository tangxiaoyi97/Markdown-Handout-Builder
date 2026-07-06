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
    "markdown-handout-builder": "^1.0.0"
  }
}
`;

  const gitignore = `node_modules/
dist/*
!dist/.gitkeep
.DS_Store
`;

  await writeScaffoldFile(path.resolve(process.cwd(), "book.yml"), book, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), "notes", "00-intro.md"), chapter, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), "package.json"), pkg, { force });
  await writeScaffoldFile(path.resolve(process.cwd(), ".gitignore"), gitignore, { force });

  console.log("");
  console.log("Next:");
  console.log("  npm install");
  console.log("  npm run install-browser");
  console.log("  npm run all");
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
