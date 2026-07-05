# Writing Rules

Use these rules for Markdown content that should build cleanly with Markdown Handout Builder.

## Directories and Chapter Order

Put official content under `notes/`. Put local images and other local assets under `notes/assets/`.

Chapter order is controlled by the `chapters` list in `book.yml`. Files not listed there are not included in the handout. Each chapter file should normally have one top-level `#` heading, which becomes the chapter title and enters the PDF outline.

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

## Unsupported Syntax

Obsidian-specific syntax is not supported:

```md
[[wikilink]]
![[embed]]
[[Note#^block-id]]
Dataview query blocks
Canvas
```

The checker fails when `[[` or `]]` appears in normal Markdown text. Fenced code blocks and inline code are ignored by this check, so shell examples such as ``[[ -f file ]]`` are safe.

Raw HTML in chapter Markdown is also disabled. Tags are escaped and displayed as text instead of being interpreted.

## Drafts and Warnings

Prefix draft filenames with `_`, for example `notes/_wip-topic.md`.

`npm run check` warns about:

- Markdown files under `notes/` that are not listed in `book.yml`.
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
- A file still contains unsupported wikilinks or embeds.
- A configured `custom_css`, cover, or back-cover file is missing.

After fixing errors, run:

```bash
npm run all
```

In GitHub Actions, inspect the failing step log. The local and CI error messages use the same checker and renderer.
