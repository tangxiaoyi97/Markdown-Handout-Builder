# Markdown Handout Builder

Build a polished handout from plain Markdown: HTML for reading, PDF for printing, and an optional GitHub Pages showcase.

**Live showcase:** [read online](https://tangxiaoyi97.github.io/Markdown-Handout-Builder/) &middot; [official PDF](https://tangxiaoyi97.github.io/Markdown-Handout-Builder/handout.pdf)

The package is designed for small note repositories. Your content repo can keep only `book.yml`, `notes/`, optional local custom templates, and a thin `package.json`. The renderer, default templates, print CSS, PDF pipeline, and preview server live in this npm package.

## Install

Requirements:

- Node.js 20 or newer.
- Playwright Chromium for PDF rendering.

In a note repository:

```bash
npm install -D markdown-handout-builder
npx mhb install-browser
```

For a new repository, generate the minimal scaffold:

```bash
npx markdown-handout-builder init
```

`mhb init` skips existing files. Use `--force` only when you intentionally want to overwrite the scaffold files.

## Minimal Repository

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

You can also call the CLI directly:

```bash
npx mhb check
npx mhb build
npx mhb pdf
npx mhb serve --port 8000
npx markdown-handout-builder init
```

The CLI reads `book.yml` from the current directory by default. Use `--config` for another file:

```bash
mhb build --config path/to/book.yml
mhb pdf --config path/to/book.yml
```

## Commands

| Command | Purpose |
|---|---|
| `mhb init` | Create a minimal note repository scaffold |
| `mhb check` | Validate `book.yml`, chapters, local images, and unsupported syntax |
| `mhb build` | Render `dist/handout.html`, theme variants, and `dist/index.html` |
| `mhb pdf` | Render official PDFs from the generated HTML |
| `mhb serve` | Start local preview and rebuild HTML on save |
| `mhb all` | Run `check`, `build`, and `pdf` |
| `mhb install-browser` | Install the Playwright Chromium version used by this package |
| `mhb install-deps` | Install Playwright Linux system dependencies in CI |

## Local Workflow

```bash
npm run check
npm run build
npm run pdf
npm run serve
npm run all
```

`check` fails on missing chapters, missing local images, invalid theme names, missing custom files, and unsupported Obsidian-specific syntax. It also warns about Markdown files under `notes/` that are not listed in `book.yml`, plus unused files under `notes/assets/`.

`serve` starts a static preview server and watches `book.yml`, `notes/`, and a local `templates/` directory if it exists:

```bash
npm run serve -- --port 8000
```

Open `http://localhost:8000/handout.html`. HTML rebuilds on save. PDF rendering is intentionally manual because it is slower.

## Configuration

Full annotated config is in [book.example.yml](./book.example.yml).

Minimal `book.yml`:

```yaml
title: "My Handout"
subtitle: "Markdown notes to HTML and PDF"
language: "en"
date: "2026-07-06"
date_format: "YYYY-MM-DD"

authors:
  - "Your Name"

chapters:
  - notes/00-intro.md
  - notes/01-topic.md

output:
  html: dist/handout.html
  pdf: dist/handout.pdf
```

### Chapters and page layout

Every `chapters` entry is a file path, and its extension decides its role: a `.md` file is a rendered **chapter**, a `.html` file is a trusted raw-HTML **insert page** (a part divider, a colophon, a diagram Markdown can't express). A mistyped path is reported by `check`, never turned into a blank page.

Use the mapping form only when an entry needs options; the list can also live in its own file:

```yaml
chapters:
  - notes/00-intro.md            # chapter
  - notes/interlude.html         # raw-HTML insert page
  - path: notes/01-topic.md      # mapping form for extra options
    class: deep-dive             #   extra CSS class on the <section>
    chapter_toc: true            #   open the chapter with a mini table of contents
# chapters: chapters.yml         # …or keep the whole list in a separate file
```

Set `chapter_toc: true` on a long chapter to open it with an auto-built list of its own sub-headings — an isolated `<nav class="chapter-toc">` that gets real PDF page numbers. Configure the default and its look at the top level:

```yaml
chapter_toc:
  default: false                 # true = on for every chapter
  title: "In this chapter"       # "" hides the heading
  depth: 3                       # include heading levels 2..depth
```

Front matter can stay in the PDF while being excluded from page numbering, so the body starts at page 1 the way a printed book does. Chapter mini-TOCs are body content and are always counted.

```yaml
pdf:
  page_numbers:
    count_cover: false           # cover stays, numbering starts after it
    count_toc: false             # the contents page carries no page number
    count_back_cover: false
```

Common options:

```yaml
toc:
  title: "Contents"
  depth: 2
  # enabled: false

pdf:
  header_footer: true
  toc_page_numbers: true
  cover_header_footer: false
  # page_size: "A4"
  # margin: "18mm 16mm 20mm 16mm"
  page_numbers:
    format: "{{page}} / {{total}}" # or "x", "x/x", "page-of-total"
    count_cover: true
    count_toc: true
    count_back_cover: true
  header:
    left: "{{title}}"
    center: ""
    right: "{{date}}"
  footer:
    left: ""
    center: "{{page}} / {{total}}"
    right: ""
  header_footer_style:
    font_size: "8.5px"
    color: "#8a919a"

style:
  # accent_color: "#111111"
  # content_width: "860px"
  # base_font_size: "16px"
  # print_font_size: "11pt"
  # fonts:
  #   body: '"Noto Serif", serif'
  #   heading: '"Inter", sans-serif'
  #   code: '"JetBrains Mono", Menlo, monospace'
  # custom_css: "templates/custom.css"
```

Default document templates, print CSS, index page, and the built-in dark theme are packaged with the CLI. You do not need to copy `scripts/` or the default `templates/` into a note repository.

Date formatting supports presets such as `YYYY-MM-DD`, `YYYYMMDD`, `YYMMDD`, `YYYY/MM/DD`, and `YY.MM.DD`. Put `date_format` at the top level for covers and index pages, or set `pdf.date_format` to override only generated PDF headers and footers.

PDF headers and footers use three slots: `left`, `center`, and `right`. Supported placeholders are `{{title}}`, `{{subtitle}}`, `{{authors}}`, `{{author}}`, `{{date}}`, `{{rawDate}}`, `{{version}}`, `{{commit}}`, `{{lang}}`, `{{theme}}`, `{{page}}`, and `{{total}}`.

`{{commit}}` is build provenance: the note repository's short git hash, with a `-dirty` suffix when the working tree has uncommitted changes, and empty outside a git repository. Builds from the same commit stay reproducible (there is deliberately no build-timestamp placeholder).

Set a top-level `version: "v2"` in `book.yml` to show a handout revision on the cover and index page; the same value is available as `{{version}}` in header/footer slots and cover fragments.

`pdf.page_numbers.count_cover: false` keeps the cover in the PDF but starts generated numbering after it. `count_toc: false` does the same for the contents page, and `count_back_cover: false` keeps the back cover in the PDF while excluding it from `{{total}}`. Chapter mini-TOCs are body content and are always counted.

### Labels and custom containers

All display labels default to English — no other language pack is built in. Localize or rename any label, and define new keys to create your own containers:

```yaml
labels:
  note: "注意"          # override a built-in label
  theorem: "定理"
  keypoint: "划重点"     # new key -> ::: keypoint, a tip-styled admonition
```

Custom containers get dedicated CSS classes (`.admonition-custom .admonition-keypoint`, default look: tip) — restyle them in a `custom_css` file. Custom keys must match `[A-Za-z][A-Za-z0-9_-]*` because they become `:::` container names and CSS classes.

### Numbering philosophy

The tool never generates content numbers. Numbers belong to the content, so write them where readers see them — Markdown stays WYSIWYG and inserting a chapter never silently shifts existing numbers:

- Chapter/section numbers: write them in headings (`## 3.2 Kinetic Energy`).
- Environments: put the number in the name (`::: theorem 3.1 Cauchy`).
- Figures: put it in the caption (`![x](a.png "Fig. 3: setup")`).
- Equations: use KaTeX's native `\tag{3.1}`.

## Writing Markdown

Put chapters under `notes/`, and put local images under `notes/assets/`. Chapter order is controlled only by `book.yml`.

Supported syntax includes:

- Headings, paragraphs, emphasis, block quotes, lists, tables, and links.
- Fenced code blocks with build-time syntax highlighting (highlight.js common set; colors themeable via `--hb-hl-*` CSS variables).
- Highlighting with `==important text==`.
- Math with inline `$F = ma$` and block `$$ ... $$`.
- Footnotes with `[^1]`.
- Admonitions: `::: note` / `tip` / `warning` / `danger` with an optional custom title, closed by `:::`.
- Academic environments: `::: theorem` / `definition` / `example` / `exercise` with an optional name after the type — write numbers yourself when you want them (`::: theorem 3.1 Cauchy` renders as "Theorem 3.1 Cauchy").
- Manual page breaks: a paragraph containing only `\pagebreak` (or `\newpage`).
- Standard Markdown images.

Image examples:

```md
![Force diagram](./assets/force.png)
![Force diagram|300](./assets/force.png)
![Force diagram|300x200](./assets/force.png)
![Force diagram](./assets/force.png "Figure 1: Force diagram")
```

An image on its own paragraph becomes a centered `<figure>`. The Markdown title becomes a `<figcaption>`.

Unsupported syntax:

```md
[[wikilink]]
![[embed]]
[[Note#^block-id]]
Dataview blocks
Canvas
```

Raw HTML in chapter Markdown is disabled. This keeps builds portable outside Obsidian and plugin ecosystems.

## Themes

Multiple themes can be rendered in one build:

```yaml
themes:
  - name: light
    label: "Light"
    default: true
  - name: dark
    label: "Dark"
    style:
      accent_color: "#eaeaea"
      custom_css: "templates/theme-dark.css"
```

Built-in themes ship with the package: `templates/theme-dark.css` (neutral dark, light fallback for browser printing), `templates/theme-sepia.css` (warm paper), and `templates/theme-academic.css` (serif, justified print). If a note repository has a file at the same path, the local file takes precedence — copy any of them as a starting point for your own theme; they are plain CSS-variable files.

Default theme output uses `output.html` and `output.pdf`. Other themes use `handout.<theme>.html` and `handout.<theme>.pdf` in the same output directory.

## Covers

The default cover uses title, subtitle, author, and date. You can replace it with a trusted HTML fragment:

```yaml
cover:
  html: "templates/cover.html"
  background: "linear-gradient(160deg, #0f2c66 0%, #4527a0 100%)"
  color: "#ffffff"

back_cover:
  enabled: true
  html: "templates/back-cover.html"
  background: "#0f172a"
  color: "#e2e8f0"
```

Cover fragments may use escaped placeholders:

```html
<p>Internal handout</p>
<h1 class="cover-title">{{title}}</h1>
<p class="cover-subtitle">{{subtitle}}</p>
<p class="cover-authors">{{authors}} &middot; {{date}}</p>
```

Fragments are trusted template code. Do not inject untrusted user content there.

## GitHub Actions Showcase

This repository includes a showcase workflow:

- [`.github/workflows/render.yml`](./.github/workflows/render.yml) builds the English showcase, uploads HTML/PDF artifacts, and deploys `dist/` to GitHub Pages on `main`.
- [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) validates and publishes the npm package.

For an independent note repository, a minimal build job can be:

```yaml
name: Build handout

on:
  push:
    branches: ["main"]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run install-browser -- --with-deps chromium
      - run: sudo apt-get update && sudo apt-get install -y --no-install-recommends fonts-noto-cjk
      - run: npm run all
      - uses: actions/upload-artifact@v7
        with:
          name: handout
          path: |
            dist/index.html
            dist/handout*.html
            dist/handout*.pdf
          retention-days: 30
```

To deploy Pages, also grant `pages: write` and `id-token: write`, then add `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

## Publishing to npm

Use npm Trusted Publishing instead of long-lived npm tokens.

Before publishing:

1. Make sure `package.json` has the correct `name`, `version`, `repository`, `bugs`, `homepage`, and `license`.
2. Run `npm run verify`.
3. Configure Trusted Publisher on npmjs.com:
   - Publisher: GitHub Actions.
   - Repository: your repository.
   - Workflow filename: `publish.yml`.
   - Allowed action: `npm publish`.
4. Create a GitHub Release to trigger the publish workflow.

Manual `workflow_dispatch` runs dry by default. Set its `publish` input to `true` only when you intentionally want to publish.

## Output

```text
dist/
  index.html
  handout.html
  handout.pdf
  handout.dark.html
  handout.dark.pdf
  assets/
```

Use the official PDF for printing or distribution. Use the HTML version for online reading and local preview.

## License and Third-Party Notices

This project is released under the MIT License. See [LICENSE](./LICENSE).

This package depends on upstream open-source projects under MIT, Apache-2.0, ISC, Unlicense, BSD-2-Clause, Python-2.0, 0BSD, and Zlib-compatible terms. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the dependency notice table.

Generated `dist/` output also includes `THIRD_PARTY_NOTICES.md`, because KaTeX font assets may be copied into `dist/assets/katex-fonts/`.

Playwright browser binaries are not bundled in this npm package. They are downloaded only when you run `mhb install-browser`, and they remain subject to their upstream browser licenses.

## Testing

```bash
npm test
```

The suite (node:test, no framework) covers `check` validation, build
output assertions, and end-to-end official PDF regression via
pdfjs-dist: page counts, bookmarks, metadata, TOC page numbers, footer
numbering including `count_cover: false` logic, and a sentinel that
fails if Chromium changes its print content-stream format (base
background recolor). PDF tests are skipped automatically when
Playwright Chromium is not installed.

## Releasing

One-time setup: create an npm Automation token and save it as the
`NPM_TOKEN` repository secret.

```bash
npm version minor        # bumps package.json + creates the git tag
git push --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`: full test
suite, showcase build, tag/version consistency check, `npm publish
--provenance`, and a GitHub Release with generated notes.
