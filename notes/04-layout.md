# Chapters and Page Layout

The `chapters` list controls both the order of the handout and the role of each page. Every entry is a file path — never a free label — and its extension decides what it becomes, so a mistyped path is caught by `check` instead of silently turning into a blank page.

## Two Kinds of Entry

A `.md` (or `.markdown`) file is a **chapter**: it is rendered from Markdown, joins the table of contents and the PDF bookmarks, and starts on a new page. A preface, an afterword, or an appendix is just an ordinary Markdown chapter.

A `.html` (or `.htm`) file is an **insert**: a trusted raw-HTML page for layout that Markdown cannot express — a part divider, a full-bleed diagram, a colophon. It is dropped in verbatim (placeholders such as `{{title}}` and `{{date}}` are filled) and, like a chapter, gets its own page.

```yaml
chapters:
  - notes/00-overview.md      # chapter
  - notes/01-quickstart.md
  - notes/interlude.html      # raw-HTML insert page
  - notes/02-writing.md
```

## Per-Entry Options

Most entries are a bare path. When an entry needs more, write it as a mapping with a `path` key. The extension still decides its role, so there is only ever one rule to remember.

```yaml
chapters:
  - notes/00-overview.md
  - path: notes/02-writing.md
    class: deep-dive          # extra CSS class on the <section>
    chapter_toc: true         # this chapter opens with a mini table of contents
```

`class` adds stable style hooks — a chapter becomes `<section class="chapter deep-dive">`, an insert `<section class="insert ...">` — that you can target from a `custom_css` file.

## Chapter Mini Tables of Contents

Set `chapter_toc: true` on a chapter to open it with an automatically built list of its own sub-headings — handy for long chapters. This very chapter uses one. The list is an isolated `<nav class="chapter-toc">`, styled independently of the main contents page, and in the PDF each row gets a real page number from the same numbering pass as the main table of contents.

Turn it on everywhere, or tune its look, from the top level:

```yaml
chapter_toc:
  default: false              # per-chapter default (true = on for every chapter)
  title: "In this chapter"    # heading above each mini table of contents
  depth: 3                    # include heading levels 2..3
  class: ""                   # extra CSS class on every chapter-toc
```

Because chapter mini-tables live in the body flow, their pages are always counted in the page numbering — only the main contents page can be excluded (see below).

## Keeping the List in a Separate File

For large handouts the chapter list can live on its own, next to `book.yml`, exactly the way `book.yml` itself does:

```yaml
# book.yml
chapters: chapters.yml
```

```yaml
# chapters.yml
- notes/00-overview.md
- notes/01-quickstart.md
- path: notes/02-writing.md
  chapter_toc: true
```

## Front Matter That Is Not Numbered

Books do not number the cover or the contents page, and neither does this tool when you ask it to. Each front-matter section can stay in the PDF while being excluded from page numbering:

```yaml
pdf:
  page_numbers:
    count_cover: false        # cover stays, numbering starts after it
    count_toc: false          # the contents page carries no number
    count_back_cover: false   # back cover excluded from the total
```

With both `count_cover` and `count_toc` off, the body starts at page 1 and the contents page still shows those real numbers — the conventional layout for a printed handout.
