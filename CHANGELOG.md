# Changelog

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
