---
title: "每章页眉页脚策略"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/structure
---
# 05 · 每章页眉页脚策略（running）

dialects 版允许**单个条目**改写官方 PDF 的页眉/页脚——关闭某条带、替换某个槽位、或逐字段覆盖排版样式——而不影响其余页面与全局配置。本章即为活演示：最后一章《book.yml 全键参考》通过 `reference` layout 把页眉中位换成了章名。

## 写法

`running` 接受 `false` 或一个映射：

```yaml
  - type: chapter
    path: notes/special.md
    running: false             # 本章页眉页脚全关

  - type: chapter
    path: notes/special.md
    running:
      footer: false            # 只关页脚，页眉保留

  - type: chapter
    path: notes/special.md
    running:
      header:
        center: "{{chapterTitle}}"    # 只改中位；left/right 继承全局 pdf.header
      footer:
        left: "Internal draft"
        center: "{{page}} / {{total}}"
        right: "Chapter A"
      style:                   # 逐字段覆盖全局 pdf.header_footer_style
        font_size: "8px"
        color: "#667085"
```

- `header` / `footer`：`true`（继承全局）、`false`（关闭该条带）、或 `left / center / right` 槽位映射（未写的槽位继承全局值）；
- `style`：`font_size` / `color` / `font_family` / `offset` 四键，逐字段继承全局；
- 策略可放进 layout 或 part 的 `defaults` 复用，**深合并**：子层只写 `header.center` 时，父层的 `footer` 与 `style` 原样保留；
- 全局 `pdf.header_footer: false` 时，显式配置了 `header` / `footer` 的章**只把该条带 opt-in 回来**，未配置的条带保持关闭。

## 占位符

槽位内容支持全部全局占位符（见第 11 章总表），外加两个章节局部量，以及本章 frontmatter 的任意键（`{{fm.<key>}}`，见第 06 章）：

| 占位符 | 值 |
|:--|:--|
| `{{chapterTitle}}` | 本条目的一级标题文本 |
| `{{sectionTitle}}` | 同上（同义别名） |

`{{page}}` / `{{total}}` 在策略页上同样是**逻辑页码**——封面、目录、封底被 `count_*: false` 剔除时，数值与全书其余页完全一致。

## 前提条件（check 会逐条把关）

1. 条目必须 `flow.break_before: page`（默认即是），且后一条目不得 `break_before: auto` 贴上来——一张物理页只能有一套页眉策略；
2. 条目必须是 **Markdown 页**且含一级标题：该标题的 PDF 书签目的地是页区间映射的锚点（raw HTML 插页与 blank 页不可携带策略；无标题的 Markdown 页构建时警告并回退全局页眉）；
3. `navigation.outline: true`（默认）——不进书签就无法定位物理页区间。

## 实现机制（为什么这样约束）

Chromium 打印只支持**一套全局**页眉/页脚模板，无法按页切换。官方管线因此在最终 PDF 上做后处理：

1. 用条目一级标题的书签目的地，把该章映射为**物理页区间**（起页 = 本章标题所在页，止页 = 下一策略章起页前一页，末章止于封底之前）；
2. **关闭**（`false`）：把对应页边距条带用页面基底色重新涂平——正文从条带之外开始，内容、链接注记、书签一概不动；
3. **改写**（槽位/样式）：把新页眉作为单页 PDF 由 Chromium 渲染（保留浏览器字形整形与 CJK 排版），裁出条带贴到目标页——每页独立渲染，逻辑页码逐页正确；
4. 封面与封底不在任何策略区间内（它们本就有独立的覆盖机制）。

## 常见配方

```yaml
layouts:
  no-footer:                   # 图版章：无页脚
    running: { footer: false }
  chapter-header:              # 书籍式：页眉中位显示章名
    running:
      header: { center: "{{chapterTitle}}" }

structure:
  - type: part
    title: "正文"
    defaults: { layout: chapter-header }   # 整部继承
    children:
      - notes/01.md
      - notes/02.md
  - type: chapter
    path: notes/gallery.md
    layout: no-footer
```

::: tip
用 `mhb inspect` 的 RUNNING 列（`+H/+F`、`-F`、`*H`、`/S`）快速核对每章最终生效的策略。
:::
