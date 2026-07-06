# Writing Syntax

Chapter content uses ordinary Markdown. Raw HTML is disabled, and Obsidian-specific syntax is rejected by the checker so builds remain portable.

## Headings and Chapters

Each chapter file should normally have one top-level heading:

```md
# Chapter Title

## Section Title

Body text.
```

Top-level headings enter the PDF outline and table of contents. In the PDF, each chapter starts on a new page. Heading IDs are generated from heading text and can be used for internal links.

## Emphasis, Highlight, and Footnotes

Markdown **bold**, *italic*, and `inline code` work directly. The package also supports `==highlight==`, for example: ==mark an important conclusion this way==.

Footnotes are useful for citations, side comments, or details that should not interrupt the main paragraph.[^install]

[^install]: Install Playwright Chromium before the first PDF render. You usually do not need to repeat this unless the Playwright version changes.

## Math

Inline math such as $F = ma$ is supported, as are block equations:

```md
$$
E_k = \frac{1}{2}mv^2
$$
```

Rendered result:

$$
E_k = \frac{1}{2}mv^2
$$

Math is rendered by KaTeX. The CSS is inlined into the HTML, and font files are copied to `dist/assets/katex-fonts/`.

## Code and Syntax Highlighting

Fenced code blocks are highlighted at build time (no runtime JavaScript). Name the language after the opening fence:

```python
def kinetic_energy(m, v):
    """Return the kinetic energy in joules."""
    return 0.5 * m * v ** 2  # E_k = 1/2 m v^2

print(kinetic_energy(70, 8.3))
```

The common highlight.js language set is included (Python, JavaScript, TypeScript, C, Java, Go, Rust, YAML, JSON, Bash, SQL, and more). Unknown languages fall back to plain escaped text. Colors adapt to light and dark themes and print into the PDF; override them with the `--hb-hl-*` CSS variables in a custom stylesheet.

## Admonitions

Call out notes, tips, warnings, and dangers with fenced containers:

```md
::: warning Check your units
Mixing units is the classic exam mistake.
:::
```

::: note
Four types are available: `note`, `tip`, `warning`, and `danger`.
:::

::: tip Optional title
The word after the type becomes the title; otherwise the type name is used.
:::

::: warning Check your units
Mixing units is the classic exam mistake.
:::

::: danger
Do not hand-edit files under `dist/` — they are overwritten on every build.
:::

## Theorems and Numbered Environments

Academic environments are numbered per chapter automatically:

```md
::: theorem Cauchy inequality
For all real numbers, $(\\sum a_i b_i)^2 \\le \\sum a_i^2 \\sum b_i^2$.
:::
```

::: theorem Cauchy inequality
For all real numbers, $(\sum a_i b_i)^2 \le \sum a_i^2 \sum b_i^2$.
:::

::: example
Numbering restarts in every chapter. Disable it with `numbering: { theorems: false }`.
:::

Four built-in types: `theorem`, `definition`, `example`, `exercise`. Define your own containers (and localize every label) via `labels` in `book.yml`. Need a hard page break? Put `\pagebreak` alone on a line.

## Tables

Tables are useful for options, commands, and comparisons:

| Markdown | Output |
|---|---|
| `![alt](./assets/a.png)` | Regular image |
| `![alt\|300](./assets/a.png)` | Fixed width |
| `![alt\|300x200](./assets/a.png)` | Fixed width and height |
| `![alt](./assets/a.png "Caption")` | Caption when the image stands alone |

Escape a pipe inside a table cell as `\|`; otherwise it is parsed as a column separator.

## Images

Put local images under `notes/assets/`. Reference them with paths relative to the current chapter:

```md
![Build pipeline|720](./assets/pipeline.svg "Figure 1: Build pipeline")
```

An image on its own paragraph is wrapped as `<figure>`, and the title field becomes `<figcaption>`. Print layout tries to keep image and caption together.

## Unsupported Syntax

These forms are not supported:

```md
[[wikilink]]
![[embed]]
[[Note#^block-id]]
```

They depend on Obsidian or plugin behavior and are not reproducible outside the editor. Use standard Markdown links and images instead.
