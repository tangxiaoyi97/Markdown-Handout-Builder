# Changelog

## 2.1.0-beta.1 — 2026-07-11 (Obsidian dialect preview)

Prerelease of the `dialects` branch; published under the `next` dist-tag.

### Fixed

- Back cover: the CSS named-page mechanism (`@page hb-backcover`) made Chromium
  emit a trailing blank page, and user CSS could silently cancel full bleed.
  The official pipeline now prints the back cover separately (single page,
  full bleed via `@page :first`) and overlays it onto the last page in
  post-processing; browser printing fills the content box exactly via the new
  `--hb-page-height` variable.
- Properties: recognize the empty frontmatter form (`---` directly followed by
  `---`) instead of leaking two `<hr>` into the chapter body; normalize
  comma-separated `tags` / `aliases` / `cssclasses` scalars into separate items
  the way Obsidian does; show property tag pills without the leading `#`
  (matching Obsidian's Properties UI) and give multi-value lists discrete pill
  styling; a YAML parse error now degrades to a build warning (the note renders
  without its properties) instead of aborting the build, and `check` reports
  broken properties in non-chapter vault notes as warnings.
- `check`/build divergence: a `%%` or an unpaired backtick inside a frontmatter
  value no longer disables wikilink validation for the rest of the note —
  frontmatter is scanned as YAML lines, never through the Markdown
  comment/code-span stripper.
- Inline parser: wikilink and tag rules now advance `state.pos` in silent
  validation mode as markdown-it requires; previously `[#tag](url)` or
  `[a [[note]] label](url)` crashed the build.
- Inline tags now require line start or preceding whitespace, exactly like
  Obsidian (`(`, `[`, `{`, `>` no longer count as boundaries).
- Callout titles are rendered with footnote state hidden, so a note containing
  footnotes no longer gets the whole footnote section spliced into a callout
  title (with duplicate element ids); the properties renderer got the same
  isolation.
- Transcluded headings are demoted (`role="paragraph"`) so PDF bookmarks list
  only the chapters' own headings; multi-level heading links
  (`[[Note#H2#H3]]`) now index every hierarchy suffix and prefer the canonical
  (non-transcluded) section over an embedded copy.
- Custom task states `[?]`, `[!]`, ... no longer print as checked + struck
  through like `[x]`: only `x`/`X`/`-` read as completed/cancelled; other
  states show their status character in a small box.
- Dialect warnings are aggregated across all theme builds instead of only the
  default theme's.

- Add opt-in `markdown.dialect: obsidian` without changing the default
  renderer. It covers the official Obsidian Flavored Markdown extension set:
  wikilinks and aliases, heading/block links, note/section/block embeds,
  comments, arbitrary task states, nested/foldable callouts, properties,
  tags, raw HTML, and offline Mermaid rendering.
- Resolve links against a configurable vault root, validate them in `check`,
  rewrite both wikilink and Markdown-style vault links, protect recursive note
  embeds from cycles, and package referenced notes/attachments under
  `dist/vault/`.
- Render official image/audio/video/PDF embeds; package Canvas/Bases embeds as
  file cards. Dynamic Search/Dataview evaluation and interactive Canvas/Bases
  views remain outside the static Markdown-rendering boundary documented in
  `DIALECTS.md`.

## 2.0.0

A reworked `chapters` system and book-style front-matter numbering. Existing
configs keep working unchanged: a plain list of `.md` paths behaves exactly as
before, so the upgrade is backward compatible despite the major version.

- Chapters can now be raw-HTML insert pages: a `.html` / `.htm` entry in
  `chapters` is inserted verbatim as its own page (placeholders like `{{title}}`
  are filled), while `.md` / `.markdown` entries stay rendered chapters. The
  extension decides the role, so a mistyped path is reported by `check` instead
  of silently becoming a blank page.
- Chapters entries accept a mapping form `{ path, class, chapter_toc }` for the
  few pages that need options; plain string paths keep working unchanged.
- Per-chapter mini tables of contents (`chapter_toc`): open a chapter with an
  auto-built list of its own sub-headings, rendered as an isolated
  `<nav class="chapter-toc">` (styled independently of the main contents page).
  Set the default and look with a top-level `chapter_toc:` block (`default`,
  `title`, `depth`, `class`). Each row gets a real page number from the same
  pass as the main TOC.
- `pdf.page_numbers.count_toc: false` keeps the contents page in the PDF while
  leaving it unnumbered, so the body starts at page 1 — the conventional printed
  layout. Composes with `count_cover` / `count_back_cover`. Chapter mini-TOCs are
  body content and are always counted.
- The `chapters` list may live in its own file: `chapters: chapters.yml`.
- New built-in theme `templates/theme-clay.css` (Clay): warm off-white paper
  with soft blue / clay / sage accents; every text color meets WCAG AA.
- `check` gains validation for every new field; `book.example.yml` and the
  GitHub Pages showcase now demonstrate inserts, chapter mini-TOCs, `count_toc`,
  and the Clay theme.

## 1.4.0

- `{{commit}}` build-provenance placeholder: the note repository's
  short git hash, with a `-dirty` suffix when the working tree has
  uncommitted changes, empty outside a git repository. Available in
  PDF header/footer slots, running headers, and cover fragments.
  Deliberately no build-timestamp placeholder: builds from the same
  commit stay byte-reproducible.
- `book.example.yml` hardening: full placeholder list in the
  header/footer section, `{{version}}` added to cover fragment
  placeholders, and a theme-level `pdf` override example.

## 1.3.0

Removed (breaking): the automatic numbering system introduced in 1.2.0
(`numbering` config, per-chapter environment/figure/equation numbers,
and generated anchors like `#theorem-3-1`). Design decision: the tool
never generates content numbers — write them directly in headings,
environment names (`::: theorem 3.1 Cauchy`), figure captions, or
KaTeX `\tag{...}`. Markdown stays WYSIWYG and inserting content never
silently shifts existing numbers. A leftover `numbering:` key now
produces a check warning. `labels` values are plain strings; custom
containers are always tip-styled admonitions (restyle via their
dedicated CSS classes). Environment names now follow the label without
parentheses so manual numbers read naturally.

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
