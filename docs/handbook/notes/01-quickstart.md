# Quickstart

This chapter shows how to use the npm package in a clean note repository. You do not need to copy this repository's `scripts/` or default `templates/`.

## Install

Use Node.js 20 or newer. Install the package and the matching Playwright Chromium browser:

```bash
npm install -D markdown-handout-builder
npx mhb install-browser
```

On Linux CI, install browser system dependencies too:

```bash
npx mhb install-browser --with-deps chromium
```

For a new repository, create the minimal scaffold:

```bash
npx markdown-handout-builder init
```

`init` skips files that already exist. Use `--force` only when you intentionally want to overwrite scaffold files.

## Minimal Structure

The smallest useful note repository looks like this:

```text
book.yml
notes/
  00-intro.md
  01-topic.md
package.json
```

Recommended `package.json`:

```json
{
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
```

## Configure book.yml

`book.yml` controls metadata, chapter order, and output paths:

```yaml
title: "My Handout"
subtitle: "Markdown notes to HTML and PDF"
language: "en"
date: "2026-07-06"

authors:
  - "Your Name"

chapters:
  - notes/00-intro.md
  - notes/01-topic.md

output:
  html: dist/handout.html
  pdf: dist/handout.pdf
```

Files not listed in `chapters` are not included in the handout. `check` warns when ordinary Markdown files under `notes/` are not listed.

## Common Commands

| Command | Purpose |
|---|---|
| `npm run check` | Validate config, chapters, images, and unsupported syntax |
| `npm run build` | Generate `dist/handout.html` and `dist/index.html` |
| `npm run pdf` | Print official PDF files from the generated HTML |
| `npm run serve` | Preview locally and rebuild HTML on save |
| `npm run all` | Run check, build, and pdf |

For local writing:

```bash
npm run serve -- --port 8000
```

Open `http://localhost:8000/handout.html`. PDF files are not rebuilt automatically; run `npm run pdf` when you need to inspect final pagination.
