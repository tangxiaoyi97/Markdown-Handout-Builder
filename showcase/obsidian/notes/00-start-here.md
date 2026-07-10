---
aliases:
  - Start Here
  - OFM Showcase
tags:
  - showcase
  - obsidian/markdown
cssclasses:
  - showcase-opening
status: Published
created: 2026-07-10
featured: true
score: 100
related:
  - "[[Reference Library]]"
source: https://obsidian.md/help/obsidian-flavored-markdown
---
# 01 · 从这里开始

这是一份由当前项目中的 `mhb` 包直接生成的 Obsidian Markdown 静态渲染成品。所有章节均来自一个真实的迷你 vault，并经过 `check → build → pdf` 完整流水线。

<span class="syntax-card">CommonMark</span>
<span class="syntax-card">GFM</span>
<span class="syntax-card">Obsidian extensions</span>
<span class="syntax-card">Offline assets</span>
<span class="syntax-card">A4 PDF</span>

## Properties / frontmatter

本页顶部展示了 YAML properties：文本、列表、数字、布尔值、日期、标签、`aliases`、`cssclasses` 与内部链接均被识别。`showcase-opening` 类也已应用到当前章节。

> [!info] 方言为显式启用
> 默认模式仍保持严格、可移植的 Markdown；本成品通过 `markdown.dialect: obsidian` 启用 vault 感知解析。

## 基础内联格式

**粗体**、*斜体*、***粗斜体***、**粗体中的 _嵌套斜体_**、~~删除线~~、==高亮文本== 与 `inline code` 可以组合出现。

反斜杠可转义 Markdown：\*这些星号保持可见\*，而 `Ctrl` + <kbd>P</kbd> 使用了可信 Raw HTML。

普通 URL 会自动链接：https://obsidian.md ，标准链接也可用：[Obsidian Help](https://obsidian.md/help)。

## 段落、换行与分隔线

单个换行遵循 Markdown 的软换行规则。
这一行仍属于同一段。

行尾两个空格会产生硬换行。  
这里已经换到下一行。

---

分隔线之后是普通引用：

> “纯文本文件应该保持长久、可移植，并能在不同工具之间流动。”
>
> — Showcase note

## 标题层级

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

六级 ATX 标题都会生成稳定锚点；主目录只收录一级标题，本章小目录展示到三级。

## 标签与注释

内联标签支持 ASCII、Unicode 与嵌套形式：#showcase #工作流/发布 #obsidian_pdf。纯数字 `#1984` 不会被误识别为标签。

注释前可见，%%这段 inline comment 不应出现在 PDF 中%% 注释后仍可见。

%%
这是一段多行注释。
它同样不会进入生成结果。
%%

## 导航

- 前往 [[Reference Library|引用目标库]]
- 查看 [[02 · 内部链接与块引用]]
- 跳到 [[Reference Library#Canonical Heading|规范标题]]
- 打开 [[Reference Library#^fact-block|事实块]]

下一章会逐一展示这些链接的解析结果。
