---
aliases:
  - Reference Library
  - Knowledge Base
tags:
  - showcase/reference
cssclasses:
  - reference-library
status: Canonical
owner: Markdown Handout Builder
---
# 07 · Reference Library

本章是 wikilink、heading link、block reference、note embed 与 Mermaid internal-link 的统一目标。

## Canonical Heading

“静态”并不意味着“丢失语义”：链接目标、标题层级、块锚点、属性与附件关系都在构建时被解析并验证。

### Nested Section

层级标题链接 `[[Reference Library#Canonical Heading#Nested Section]]` 会精确落到这里。

#### Deep Anchor

更深层标题仍然有稳定 ID，并可用于标准 Markdown fragment。

## Block Reference Targets

这是一条带人类可读 ID 的事实段落：Obsidian Markdown 是 CommonMark、GFM、LaTeX 与 Obsidian 扩展的组合。 ^fact-block

结构化列表通过独立标识符成为可嵌入块：

- CommonMark foundation
- GitHub Flavored Markdown tables and strikethrough
- Obsidian wikilinks, embeds, blocks, comments, tasks and callouts
- Properties, tags, Mermaid and accepted attachments

^reference-list

## Backlinks in content

- 返回 [[Start Here|Showcase 首页]]
- 返回 [[Link Lab|链接实验室]]
- 返回 [[Mermaid and Boundaries|Mermaid 与边界]]

> [!success] End-to-end
> 如果你正在阅读这份 PDF，说明 properties、链接解析、transclusion、代码高亮、KaTeX、Mermaid、附件复制、Chromium 打印和 PDF 后处理已共同完成。

