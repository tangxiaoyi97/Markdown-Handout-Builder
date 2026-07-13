# Writing Rules

Use these rules for Markdown content that should build cleanly with Markdown Handout Builder.

## Directories and Chapter Order

Put official content under `notes/`. Put local images and other local assets under `notes/assets/`.

Document order is controlled by either `chapters` (compact, backward-compatible) or `structure` (parts, includes, layouts, and per-entry policies) in `book.yml`. Files not listed or included there are not part of the handout. Each chapter file should normally have one top-level `#` heading, which becomes the chapter title and enters the PDF outline. A per-entry `running` policy does not require a heading, but its entry must own a physical page boundary. That policy may disable a header/footer band or override its `left`, `center`, and `right` slots plus `style`; omitted values inherit the global PDF configuration.

## Supported Syntax

Standard Markdown is supported:

```md
# Heading 1
## Heading 2
### Heading 3

Paragraph text, **bold**, *italic*, `inline code`

> Block quote

- Unordered list
1. Ordered list

| Term | Meaning |
|---|---|
| Force | Interaction that changes motion |
```

Use fenced code blocks with three backticks.

Additional supported syntax:

Highlight:

```md
==Important text==
```

Math:

```md
Inline math: $F = ma$

$$
F = m \cdot a
$$
```

Footnotes:

```md
This sentence has a footnote.[^1]

[^1]: Footnote content.
```

## Links

Use standard Markdown links:

```md
[Link text](https://example.com)
```

External links open in a new tab in the HTML output. Internal heading links may use generated IDs:

```md
[See the introduction](#introduction)
```

## Images

Put image files under `notes/assets/`, then reference them from chapter Markdown:

```md
![Force diagram](./assets/force.png)
```

Advanced image forms:

```md
![Force diagram|300](./assets/force.png)
![Force diagram|300x200](./assets/force.png)
![Force diagram](./assets/force.png "Figure 1: Force diagram")
```

An image on its own paragraph is centered and rendered as a figure. The Markdown title becomes the caption.

Relative paths are resolved from the current Markdown file. Remote images such as `https://...` are allowed. Prefer filenames without spaces. Missing local images fail `npm run check` with file and line information.

## Default Dialect: Unsupported Syntax

Obsidian-specific syntax is not supported unless the experimental dialect is enabled:

```md
[[wikilink]]
![[embed]]
[[Note#^block-id]]
Dataview query blocks
Canvas
```

The checker fails when `[[` or `]]` appears in normal Markdown text. Fenced code blocks and inline code are ignored by this check, so shell examples such as ``[[ -f file ]]`` are safe.

Raw HTML in chapter Markdown is also disabled. Tags are escaped and displayed as text instead of being interpreted.

## Obsidian Dialect

For a trusted Obsidian vault, enable the dialect in `book.yml`:

```yaml
markdown:
  dialect: obsidian
  obsidian:
    vault_root: "."
    properties: visible  # visible | hidden | source
```

You may then use wikilinks, heading/block links, note/section/block embeds,
official attachment embeds, `%%` comments, task states, tags, properties,
Mermaid, raw HTML, and Obsidian callouts such as:

```md
[[Mechanics#Momentum|review momentum]]
![[Mechanics#^impulse-example]]
![[assets/collision.png|480x270]]

> [!warning]- Assumption
> This foldable callout supports **Markdown** and [[wikilinks]].
```

The checker resolves targets against the configured vault before building.
Keep `book.yml` at the vault root or set `vault_root` explicitly. Obsidian mode
trusts raw HTML; do not enable it for untrusted content. See `DIALECTS.md` for
the exact compatibility matrix and the boundary around plugin/application
features.

## Drafts and Warnings

Prefix draft filenames with `_`, for example `notes/_wip-topic.md`.

`npm run check` warns about:

- Markdown files under `notes/` that are neither listed in `book.yml` nor
  included in the document structure or transcluded by an Obsidian note embed.
- Unused files under `notes/assets/`.

These warnings do not fail the build. Draft files prefixed with `_` are ignored by the unlisted-chapter warning.

## Local Preview

Run:

```bash
npm run serve
```

Then open `http://localhost:8000/handout.html`. Saving Markdown rebuilds HTML and refreshes the browser. PDF files are not rebuilt automatically.

## Troubleshooting

Start with:

```bash
npm run check
```

Errors include file and line information. Common causes:

- A chapter listed in `book.yml` does not exist.
- A local image path is wrong.
- A file contains unsupported wikilinks/embeds in the default dialect, or an
  Obsidian target cannot be resolved in the Obsidian dialect.
- A configured `custom_css`, cover, or back-cover file is missing.

After fixing errors, run:

```bash
npm run all
```

In GitHub Actions, inspect the failing step log. The local and CI error messages use the same checker and renderer.
