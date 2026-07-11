---
aliases:
  - Tasks and Callouts
tags:
  - showcase/callouts
cssclasses:
  - callout-catalog
status: Complete
---
# 03 · 任务与 Callouts

## Task lists

Obsidian 允许方括号内使用任意字符表示自定义任务状态；静态输出将 `x`/`-` 视为完成/取消（划线弱化），其余自定义状态在方框中直接展示状态字符，语义不丢失。

- [ ] 未完成：整理 vault
- [x] 已完成：解析 wikilinks
- [?] 待确认：检查 alias
- [!] 重要：复验 PDF
- [-] 已取消：旧的导出路径

嵌套任务可以和普通列表混合：

1. 构建流水线
   - [x] check
   - [x] build
   - [x] pdf
2. 视觉验收
   - [x] 页眉页脚
   - [x] 目录与书签

## 官方 Callout 类型目录

> [!note] Note

> [!abstract] Abstract / Summary / TLDR

> [!info] Info

> [!todo] Todo

> [!tip] Tip / Hint / Important

> [!success] Success / Check / Done

> [!question] Question / Help / FAQ

> [!warning] Warning / Caution / Attention

> [!failure] Failure / Fail / Missing

> [!danger] Danger / Error

> [!bug] Bug

> [!example] Example

> [!quote] Quote / Cite

> [!custom-showcase] Custom type

## 自定义标题与 Markdown 正文

> [!tip] 自定义标题：内容可组合
> Callout 正文支持 **粗体**、==高亮==、列表、[[Reference Library|wikilinks]] 和嵌入语法。
>
> - 第一项
> - 第二项

## 折叠状态

> [!success]+ 默认展开
> `+` 表示可折叠且初始展开；这段正文进入 HTML 与 PDF。

> [!faq]- 默认折叠
> `-` 表示初始折叠；PDF 中保留标题，以展示静态折叠状态。

## 嵌套 Callouts

> [!question] Callout 可以嵌套吗？
> > [!todo] 可以
> > > [!example] 任意层级
> > > 内层仍可使用 **Markdown**、标签 #nested/tag 与 [[Reference Library#^fact-block|块链接]]。

普通 blockquote 不带 `[!type]`，因此仍保持为标准引用样式。

> 这是普通引用，不是 callout。
