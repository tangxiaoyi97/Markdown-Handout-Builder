---
aliases:
  - 02 · 内部链接与块引用
  - Link Lab
tags:
  - showcase/links
status: Complete
---
# 02 · 内部链接与块引用

Obsidian 的内部链接既可以使用紧凑的 wikilink，也可以使用标准 Markdown 链接。本章的所有目标都由 vault resolver 在构建前验证。

## Note links 与 aliases

- 文件名：[[Reference Library]]
- 自定义显示文本：[[Reference Library|知识库]]
- 通过 alias：[[Knowledge Base]]
- 同页标题：[[#Local Heading]]
- 标准 Markdown 路径：[Markdown form](Reference%20Library.md#Canonical%20Heading)
- 外部 Obsidian URI：[Open in Obsidian](obsidian://open?vault=Showcase&file=Reference%20Library.md)

## Heading links

- 标题：[[Reference Library#Canonical Heading]]
- 自定义标题文本：[[Reference Library#Canonical Heading|规范标题]]
- 层级子标题：[[Reference Library#Canonical Heading#Nested Section]]

### Local Heading

这个标题是同页 `[[#Local Heading]]` 的目标。

## Block links

简单段落可在行尾定义人类可读的块 ID；标识符本身在阅读视图和 PDF 中隐藏。 ^local-block

- 跳到当前段落：[[01-links-and-blocks#^local-block|本地段落块]]
- 跳到其他笔记：[[Reference Library#^fact-block|事实块]]

结构化内容使用独立的块标识符：

- 列表项 A
- 列表项 B
- 列表项 C

^local-list

这个完整列表可通过 [[01-links-and-blocks#^local-list|本地列表块]] 定位。

## Forward links 与稳定锚点

链接可以指向尚未渲染的后续章节。构建器完成全部章节后统一回填锚点，因此 [[Reference Library#Canonical Heading#Nested Section|前向层级链接]] 仍能得到正确目的地。

> [!success] 解析策略
> 精确 vault 路径优先，其次是相对当前笔记的路径，最后按最近目录解析文件名与 alias；歧义会在 `mhb check` 中报告。
