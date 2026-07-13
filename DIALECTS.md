# Markdown Dialects

Markdown Handout Builder keeps its original renderer as the default and offers
Obsidian Flavored Markdown as an explicit, experimental dialect. This document
defines the compatibility boundary so “supported” has a testable meaning.

## Main-branch baseline

The baseline below records the behavior of `main` at `a2c52ff` (`v2.0.0`),
before the `dialects` branch. `markdown.dialect: standard` (and configurations
with no `markdown` key) retains that Markdown syntax and raw-HTML safety model,
with one deliberate v3 compatibility change: a leading YAML frontmatter block
is now parsed and removed from the rendered body in both dialects. See
"Compatibility note" below and the 2.3.0 changelog before upgrading.

### Compatibility note: v3 frontmatter

On main, YAML properties were misinterpreted as ordinary Markdown. In the v3
dialect package they are metadata in every dialect, so a document that
intentionally displayed a leading `---` YAML block must fence it as code. This
is a documented breaking behavior change; all other Obsidian-only syntax still
requires `markdown.dialect: obsidian`.

### Supported on main

| Area | Syntax and behavior |
|---|---|
| Markdown blocks | Paragraphs, ATX/setext headings, block quotes, horizontal rules, ordered/unordered lists, fenced/indented code, and tables |
| Markdown inline | Emphasis, strong emphasis, strikethrough, code spans, escapes, standard links/images, autolinks, and URL linkification |
| Headings | Globally unique Unicode-aware IDs, main/chapter TOCs, PDF bookmarks, and cross-chapter duplicate handling |
| Code | Build-time highlight.js syntax highlighting |
| Math | Inline/block KaTeX, including author-supplied `\tag{...}` |
| Footnotes | Named/numbered references and inline footnotes, namespaced per chapter |
| Highlight | `==highlight==` |
| Handout containers | `::: note`, `tip`, `warning`, `danger`; theorem/definition/example/exercise; configured custom containers |
| Images | Standard Markdown images, `alt\|width` / `alt\|widthxheight`, standalone figures, and title captions |
| Pagination | Standalone `\pagebreak` and `\newpage` markers |
| Safety | Raw HTML in Markdown chapters is escaped; raw HTML is only trusted in explicit `.html` insert pages |

### Obsidian syntax on main

| Obsidian feature | Main-branch status |
|---|---|
| Tables, strikethrough, highlight, math, footnotes | Supported by the baseline renderer |
| External image sizing (`![alt\|100](url)`) | Supported |
| `[[wikilinks]]`, heading links, block links | Rejected by `check` |
| `![[embeds]]` | Rejected by `check` |
| Task lists | Rendered as literal `[ ]` / `[x]` text |
| `%% comments %%` | Rendered as visible text |
| `> [!type]` callouts | Rendered as an ordinary block quote |
| `^block-id` definitions | Rendered as visible text |
| YAML properties | Misinterpreted as ordinary Markdown |
| Tags | Rendered as plain text |
| Mermaid | Rendered as a code block, not a diagram |
| Raw HTML | Escaped |

## Obsidian dialect

Enable it explicitly:

```yaml
markdown:
  dialect: obsidian
  obsidian:
    vault_root: "."       # relative to book.yml; default: .
    properties: visible  # visible | hidden | source
```

The configuration directory is the vault root by default. `check` validates
the options, properties, link targets, attachment targets, and ambiguity before
building. Existing projects do not change behavior until the dialect is
enabled.

### Static-rendering coverage

| Obsidian feature | Dialect behavior |
|---|---|
| Wikilinks | Note/path/alias links; custom display text; same-note links; heading and hierarchical subheading links; block links |
| Markdown internal links | Local `.md` and attachment destinations use the same vault resolver as wikilinks |
| Block definitions | Paragraph, list-item, quote, callout, table/list marker forms receive stable, hidden HTML anchors |
| Note embeds | Whole note, heading section, and block/list transclusion; nested transclusion; cycle detection; embedded headings stay out of the handout TOC |
| Image embeds | All official image extensions; width and width×height sizing; attachments are copied under `dist/vault/` |
| Audio/video embeds | Native HTML controls for the official Obsidian media extensions |
| PDF embeds | PDF object with `#page=N` and `#height=N` support plus a link fallback |
| Canvas/Bases embeds | Safe file card and copied source file; see the semantic-rendering boundary below |
| Comments | Inline and multiline `%% ... %%` comments are removed; fenced code and code spans are preserved |
| Task lists | `[ ]`, `[x]`, and any custom status character; `x`/`-` print as checked + struck-through (done/cancelled), other states show their status character in a small box |
| Callouts | Built-in aliases and custom types, Markdown titles/body, `+`/`-` folding, and arbitrary nesting |
| Properties | YAML/JSON frontmatter; visible/hidden/source display; aliases, tags, `cssclasses`, links, lists, scalars, dates, booleans |
| Tags | Unicode and nested inline tags with Obsidian's “at least one non-number” rule; recognized only at line start or after whitespace, as in Obsidian |
| Raw HTML | Enabled to match Obsidian/CommonMark behavior; Markdown is not reparsed inside HTML blocks |
| Mermaid | Rendered offline to SVG in HTML and awaited before PDF pagination; flowchart nodes with Obsidian's `internal-link` class become vault links |
| Shared syntax | CommonMark/GFM tables and strikethrough, highlighting, footnotes, KaTeX, code, and image sizing remain available |

Wikilink targets are resolved deterministically: exact vault path, path relative
to the current note, then filename/alias using the closest directory. An
equally close ambiguity produces a `check` warning and reports the selected
path. Links to chapters become in-handout anchors. Referenced notes that are not
chapters are copied under `dist/vault/` and linked as source files.

Raw HTML is trusted in Obsidian mode, just as it is in Obsidian itself. Do not
enable the dialect for untrusted Markdown.

## Boundary: syntax versus Obsidian application features

“Full coverage” here means every entry in Obsidian's official **Obsidian
Flavored Markdown** extension table, plus static properties, tags, Mermaid, and
the accepted attachment/embed formats. The following are intentionally not
claimed as Markdown syntax:

- Dataview and other community-plugin languages are not executed.
- `query` fences are kept as code; evaluating Search core-plugin queries would
  require reproducing Obsidian's live vault search engine.
- `.canvas` and `.base` files are linked and packaged, but their interactive
  application views are not reproduced in a static handout.
- Editor-only behavior such as checkbox mutation, hover previews, graph view,
  automatic rename updates, and command/URI actions is not part of HTML/PDF
  rendering.

This boundary follows Obsidian's own separation between its Markdown flavor,
core plugins, community plugins, and separate Canvas/Bases file formats.
