# Document Structure and Page Layout

`chapters:` remains the shortest way to order a simple handout. For a book with front matter, parts, includes, reusable layouts, or per-chapter page policies, use `structure:`. The two spellings are mutually exclusive and normalize to the same linear renderer sequence.

## Compact Chapters

A Markdown file is a rendered chapter; an HTML file is a trusted insert. Existing configurations remain unchanged:

```yaml
chapters:
  - notes/00-overview.md
  - path: notes/02-writing.md
    class: deep-dive
    chapter_toc: true
  - notes/colophon.html
```

## Semantic Structure

The long form uses an explicit discriminator and can represent the whole document flow:

```yaml
structure:
  - type: insert
    path: front/preface.md
  - type: contents
  - type: part
    title: "Part One"
    navigation:
      label: "I · Foundations"
      level: 1
    children:
      - type: chapter
        path: notes/01-intro.md
      - include: parts/foundations.yml
  - type: blank
    count: 1
```

`part` is semantic, not merely decorative: its divider gets a real heading and PDF bookmark, while child chapters inherit a deeper main-TOC level. Includes are resolved relative to the YAML file that contains them; chapter paths stay relative to `book.yml`. Include cycles and ambiguous entry types fail during `check`.

## Named Layouts

Layouts collect reusable entry defaults. Inheritance is resolved before rendering, and classes from parent and child layouts are combined:

```yaml
layouts:
  body:
    class: layout-body
    chapter_toc: true

  compact:
    extends: body
    class: layout-compact
    flow:
      break_before: auto

structure:
  - type: chapter
    path: notes/short-note.md
    layout: compact
```

Use the stable `data-layout` attribute or generated classes from `style.custom_css`. A layout controls policy and hooks; typography remains CSS, so the configuration does not become a second styling language.

## Flow and Navigation

Pagination and navigation are independent:

```yaml
- type: chapter
  path: notes/appendix.md
  flow:
    break_before: page        # page | auto
    break_after: auto         # page | auto
  navigation:
    toc: true
    label: "Appendix A"
    level: 2
    outline: true
```

`outline: false` currently requires `toc: false`, because the real TOC page-number pass uses PDF outline destinations. Chromium ignores `break-before: recto`; recto/verso starts are therefore not exposed as a misleading option.

## A Markdown Chapter Without a Footer

Content rendering and running furniture are separate. This is a normal Markdown chapter whose official PDF pages retain the header but omit the footer:

```yaml
- type: chapter
  path: notes/special.md
  running:
    footer: false
```

The chapter must start on a new page and contain one top-level heading. Chromium offers only one global header/footer template, so the final PDF pass maps that heading to its physical page range and repaints only the footer margin band. Body content, links, bookmarks, and page-number calculations stay intact.

The policy can be reused through a layout:

```yaml
layouts:
  no-footer:
    running:
      footer: false

structure:
  - type: chapter
    path: notes/special.md
    layout: no-footer
```

## Chapter-Specific Header and Footer Content

A band may be a three-slot mapping instead of a boolean. Only the named slots change; the other slots inherit the global `pdf.header` or `pdf.footer` configuration. The `font_size`, `color`, `font_family`, and `offset` style values likewise inherit from `pdf.header_footer_style`:

```yaml
- type: chapter
  path: notes/special.md
  running:
    header:
      center: "{{chapterTitle}}"
    footer:
      left: "Internal draft"
      center: "{{page}} / {{total}}"
      right: "Chapter A"
    style:
      font_size: "8px"
      color: "#667085"
```

The chapter-local placeholders `{{chapterTitle}}` and `{{sectionTitle}}` both resolve to the entry's top-level heading. Every global placeholder remains available, and page placeholders use logical numbering even when the cover, main contents, or back cover is excluded from the count. Layout inheritance deep-merges `header`, `footer`, and `style`, so a child layout can replace one slot without repeating the rest. With `pdf.header_footer: false`, an explicitly configured chapter `header` or `footer` opts only that band back in; omitted bands remain off.

## Inspect Before Rendering

Use the normalized view when a book has nested parts or includes:

```bash
mhb inspect
mhb inspect --json
```

The table shows every flattened entry, resolved layout, page-break policy, TOC/outline status, running header/footer status, and source path.

## Front-Matter Numbering

Front matter can remain in the PDF without joining logical body numbering:

```yaml
pdf:
  page_numbers:
    count_cover: false
    count_toc: false
    count_back_cover: false
```

Chapter mini-TOCs remain body content and are always counted.
