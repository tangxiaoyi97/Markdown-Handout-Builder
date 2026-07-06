# Changelog

## 1.2.0

- Numbered academic environments: `::: theorem` / `definition` /
  `example` / `exercise`, auto-numbered per chapter with linkable
  anchors; optional figure numbering (`numbering.figures`) and block
  equation numbering (`numbering.equations`, manual `\tag` respected).
- Labels: English-only defaults with full localization via `labels`;
  new keys define custom containers (tip-styled admonitions or, with
  `numbered: true`, academic environments) with dedicated CSS classes.
- Manual page breaks: `\pagebreak` / `\newpage` on their own line.
- `version` field in `book.yml`: shows the handout revision on the
  default cover, back cover, and index page, and is available as the
  `{{version}}` placeholder in PDF header/footer slots, running
  headers, and cover fragments.
- Admonitions: `::: note` / `tip` / `warning` / `danger` fenced
  containers with optional custom titles, themeable via `--hb-adm-*`
  variables (light and dark palettes), kept unsplit across PDF pages.
- Two new built-in themes: `theme-sepia.css` (warm paper, print-safe)
  and `theme-academic.css` (serif typography, justified print with
  hyphenation).

## 1.1.0

- Build-time syntax highlighting for fenced code blocks (highlight.js
  common language set), themeable via `--hb-hl-*` CSS variables with
  light and dark palettes.
- Test suite (`npm test`, node:test): check validation positives and
  negatives, build output assertions, and end-to-end official PDF
  regression (pages, outline, metadata, TOC page numbers, footer
  numbering, `count_cover` logic, dark theme base recolor sentinel).
- Release automation: pushing a `v*` tag runs the full verification and
  publishes to npm with provenance, then creates a GitHub Release.
- CI now runs the test suite on every push and pull request.

## 1.0.0

First stable release. Markdown → HTML + official PDF via a Chromium
print pipeline: covers and back covers, table of contents with real
page numbers, configurable headers/footers and page numbering,
multi-theme builds (light/dark), KaTeX math, image captions and
sizing, footnotes, local preview server, `mhb init` scaffolding, and a
GitHub Pages workflow.
