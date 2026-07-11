# Markdown Handout Builder

Build a polished handout from plain Markdown: HTML for reading, PDF for printing, and an optional GitHub Pages showcase.

**Live showcase:** [read online](https://tangxiaoyi97.github.io/Markdown-Handout-Builder/) &middot; [handbook PDF (2.0)](https://tangxiaoyi97.github.io/Markdown-Handout-Builder/handout-2.0.pdf) &middot; [Obsidian dialect showcase PDF (1.0-dialect)](https://tangxiaoyi97.github.io/Markdown-Handout-Builder/showcase/obsidian-syntax-showcase-1.0-dialect.pdf)

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
| `mhb check` | Validate configuration, chapters, local assets, and dialect-specific links/syntax |
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

`check` fails on missing chapters/assets, invalid theme or dialect settings, missing custom files, and unsupported syntax. In the opt-in Obsidian dialect it also resolves wikilinks and recursively validates embedded notes, reporting missing or ambiguous vault targets. It warns about Markdown files under `notes/` that are neither listed nor transcluded, plus unused files under `notes/assets/`.

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

A file entry's extension decides its default role: a `.md` file is a rendered **chapter**, a `.html` file is a trusted raw-HTML **insert page**. A mistyped path or entry key is reported by `check`, never turned into a blank page.

Beyond files, the list gives you full control over front matter and special pages — Markdown insert pages (`as: insert`), declared part dividers and blank pages (no file needed), a repositionable main TOC, and per-entry main-TOC control:

```yaml
chapters:
  - path: front/preface.md       # a Markdown special page: rendered, but out of
    as: insert                   #   the main TOC, styled as an insert page
  - contents: true               # place the main TOC here (front-matter order:
                                 #   title page → preface → contents → body)
  - divider:                     # declared part-divider page — no file needed
      title: "Part One"          #   a real <h1>: PDF bookmark + TOC page number
      subtitle: "Foundations"
      background: "#25304a"      #   any CSS color or gradient
      color: "#ffffff"
      bleed: true                #   official PDF paints it edge-to-edge
      toc: "Part One"            #   optional main-TOC row
  - notes/00-intro.md            # chapter (string form)
  - blank: true                  # intentionally blank page (duplex layouts)
  - notes/interlude.html         # raw-HTML insert page (escape hatch)
  - path: notes/01-topic.md      # mapping form for extra options
    class: deep-dive             #   extra CSS class on the <section>
    chapter_toc: true            #   open the chapter with a mini table of contents
    toc: "Chapter One"           #   rename its main-TOC row (or toc: false to hide)
# chapters: chapters.yml         # …or keep the whole list in a separate file
```

Notes on the declared pages: a divider occupies exactly one page and its `title` is a real heading (so it gets a PDF bookmark and a real page number in the TOC); `bleed: true` makes the official PDF pipeline print that page standalone and overlay it edge-to-edge — the same mechanism as the back cover. Blank pages and in-flow contents are always counted in page numbering; `pdf.page_numbers.count_toc: false` only applies to the default (front-of-book) TOC position.

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

In the default `standard` dialect, Obsidian-specific syntax remains unsupported:

```md
[[wikilink]]
![[embed]]
[[Note#^block-id]]
Dataview blocks
Canvas
```

Raw HTML in standard-dialect chapter Markdown is disabled. This keeps default builds portable outside Obsidian and plugin ecosystems.

### Experimental Obsidian dialect

Opt in per book; existing configurations retain standard behavior:

```yaml
markdown:
  dialect: obsidian
  obsidian:
    vault_root: "."       # relative to book.yml; default: .
    properties: visible  # visible | hidden | source
```

The dialect covers Obsidian wikilinks (aliases, headings, hierarchical headings, and blocks), Markdown-style vault links, note/section/block transclusion, accepted image/audio/video/PDF attachments, comments, task states, nested and foldable callouts, properties, `cssclasses`, tags, raw HTML, and offline Mermaid rendering. Referenced attachments and non-chapter note sources are copied to `dist/vault/`; Mermaid is rendered before PDF pagination.

Obsidian mode trusts raw HTML, so enable it only for trusted vault content. Dataview and other community-plugin languages are not executed; Search query evaluation and interactive Canvas/Bases views are application features rather than Markdown syntax. Canvas and Bases embeds degrade to packaged file cards.

See [DIALECTS.md](DIALECTS.md) for the exact `main@a2c52ff` support list, the full coverage matrix, resolution rules, and scope boundary.

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

Built-in themes ship with the package: `templates/theme-dark.css` (neutral dark, light fallback for browser printing), `templates/theme-sepia.css` (warm paper), `templates/theme-clay.css` (warm off-white with soft blue / clay / sage accents), and `templates/theme-academic.css` (serif, justified print). If a note repository has a file at the same path, the local file takes precedence — copy any of them as a starting point for your own theme; they are plain CSS-variable files.

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

- [`.github/workflows/render.yml`](./.github/workflows/render.yml) builds this repo's two documentation books — the handbook (`docs/handbook/`, edition 2.0) and the Obsidian dialect showcase (`docs/obsidian-showcase/`, edition 1.0-dialect) — uploads HTML/PDF artifacts, and deploys `dist/` to GitHub Pages on `main`.
- [`.github/workflows/release.yml`](./.github/workflows/release.yml) verifies, publishes the npm package, and creates the GitHub Release when a `v*` tag is pushed (see [Releasing](#releasing)).

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

Releases use npm Trusted Publishing (OIDC) — no long-lived npm token is
stored in the repository. One-time setup on npmjs.com → package →
Settings → Trusted Publisher: Publisher "GitHub Actions", this
repository, workflow filename `release.yml`.

```bash
npm version minor        # bumps package.json + creates the git tag
git push --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml` — the single
release pipeline: full test suite, root handout and Obsidian showcase
builds, tag/version consistency check, `npm publish --provenance` via
Trusted Publishing, then a GitHub Release with generated notes.
A prerelease version (`2.1.0-beta.1`) publishes under the `next`
dist-tag and marks the GitHub Release as a prerelease.

Manual `workflow_dispatch` runs of the same workflow are dry runs by
default; set the `publish` input to `true` only when you intentionally
want to publish outside the tag flow.
