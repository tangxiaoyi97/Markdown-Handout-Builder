---
title: "文档结构语言"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/structure
---
# 03 · 文档结构语言

文档顺序由 `book.yml` 里的 **`chapters:`（紧凑形）** 或 **`structure:`（语义形）** 声明。两者**二选一**，同时出现是错误；它们归一化为同一套扁平渲染序列，因此紧凑形能做的，语义形都能做，反之亦然。整份清单也可以外置：`chapters: chapters.yml`（或 `structure: structure.yml`），指向一个 YAML 列表文件。

## 条目的三种写法

**① 字符串**——就是文件路径，扩展名决定角色：

```yaml
chapters:
  - notes/00-intro.md        # .md/.markdown → chapter（渲染章节）
  - notes/interlude.html     # .html/.htm    → insert（受信原样插页）
```

**② 映射（紧凑形）**——`path` 加逐条目选项：

```yaml
  - path: notes/02-deep.md
    as: insert               # 角色覆盖（role 同义）；.html 不可作 chapter
    class: deep-dive         # 附加到 <section> 的 CSS class
    layout: body             # 引用命名 layout（见第 04 章）
    chapter_toc: true        # 开章小目录（仅章节有意义）
    toc: "第二章（改名）"      # 主目录行文案；toc: false 则整章不进主目录
    navigation: { level: 2 } # 见第 04 章
    flow: { break_before: page, break_after: auto }
    running: { footer: false }   # 见第 05 章
```

**③ 显式 `type:`（语义形）**——同样的键，判别子写在条目上：

```yaml
structure:
  - type: chapter            # chapter | insert | divider | blank | contents | part | include
    path: notes/00-intro.md
```

映射条目必须**恰有一个**类型判别（`path` / `divider` / `blank` / `contents` / `part` / `include` 之一，或显式 `type:`）；未知键一律报错——拼写错误不可能静默变成空白页。

## 全部条目类型

### chapter —— 渲染章节

Markdown 渲染；一级标题成为章名（主目录行 + PDF 书签 + running 锚点）。可选键：`class` `layout` `chapter_toc` `toc` `navigation` `flow` `running`。

### insert —— 特殊页

两种来源，同一角色（不进主目录、按插页排版、带运行页眉）：

- **`.html` 文件**：受信原样片段，`{{title}}` 等全局占位符会被填充。是 Markdown 表达不了的版式的逃生门。
- **`.md` + `as: insert`（或 `type: insert`）**：前言、致谢、版权页——照常渲染 Markdown，但不进主目录。注意：raw HTML 插页**不能**携带 running 策略（策略需要 Markdown 一级标题作页区间锚点）。

### divider —— 篇章隔页（无文件）

一整页的隔页卡，全部键：

```yaml
  - divider:                      # 或 type: divider 平铺同名键
      title: "第一部分"            # 真实 <h1>：进书签；bleed 时必填
      subtitle: "Foundations"
      note: "可选的第三行说明"
      class: part-one             # 交给 custom_css 深度定制
      layout: quiet               # 也可引用 layout
      background: "linear-gradient(150deg, #1d2a44, #5f58b6)"   # 任意 CSS 颜色/渐变
      color: "#ffffff"
      bleed: true                 # 官方 PDF 满版出血（独立单页打印 + 整页覆盖）
      toc: "第一部分"              # 主目录行（divider 默认不进；part 默认进）
      navigation: { level: 1 }
      flow: { break_before: page }
```

隔页恰占一页由打印规则保证（与封底同一套「安全 min-height」模式）。`bleed: true` 的背景在官方 PDF 中铺满整页；浏览器直接打印时铺满正文区（内容盒）。至少要有 title / subtitle / note / class 之一。

### blank —— 有意的空白页

```yaml
  - blank: true                  # 一页
  - blank: 2                     # 1–20 页
  - type: blank                  # 长写法可带 count / class / layout / flow
    count: 1
```

用于双面印刷的对页排版。空白页照常计页、带页眉页脚，但**不能**携带 running 策略（没有可寻址的标题锚点）。

### contents —— 主目录布点

```yaml
  - contents: true               # 或 type: contents；全书至多一次
```

不写此条目时，主目录默认在封面之后。写了它，目录就渲染在文档流中的这个位置——经典的前置页顺序（扉页 → 前言 → 目录 → 正文）由此实现。**流内目录恒计页**：`pdf.page_numbers.count_toc: false` 与之冲突时被忽略并警告（页码拼接机制假设被剔除的目录紧随封面）。

### part —— 部（语义分组）

part = 一页 divider + 一组子条目 + 可继承的 defaults：

```yaml
  - type: part                   # 紧凑形为 - part: {…}
    title: "第一部分"
    subtitle: "Foundations"
    bleed: true
    navigation: { label: "I · Foundations", level: 1 }
    defaults:                    # 后代条目的默认值（可被子条目覆盖）
      layout: body
      class: part-one-page
    children:                    # chapters / structure 是同义键
      - notes/01-a.md
      - include: parts/more.yml
      - type: part               # 部可以再嵌套
        title: "第一部分 · 补编"
        children: [notes/01-c.md]
```

部标题拥有真实标题与书签；**子章节的主目录层级自动加深一层**（部在 level 1，则子章 level 2），也可用 `defaults.navigation.level` 显式指定。divider 的全部键（背景、出血、note……）对 part 同样可用；区别是 part 的 `toc` **默认开启**（divider 默认关闭）。展平发生在归一化阶段，渲染管线始终消费线性序列。

### include —— 递归包含

```yaml
  - include: parts/foundations.yml     # 或 type: include + path:
```

被包含文件是一个 YAML 列表（或带 `structure:` / `chapters:` 键的映射），内容可再嵌 part / include。**include 路径相对于包含它的 YAML 文件**解析；其中的章节路径仍相对于 `book.yml`。包含环是硬错误，`mhb serve` 会自动监听全部递归包含文件。

## 继承与合并顺序

每个条目的最终策略 = **layout（含 extends 链） → 外层 part 的 defaults（逐层） → 条目自身**，后者覆盖前者；`class` 取并集，`running` 的 header / footer / style 深合并（见第 05 章）。用 `mhb inspect` 验证展平与继承结果。

## 结构级校验

- `structure` 与 `chapters` 并用 → 错误；
- 至少一条 `.md` / `.html` 文件页；`contents` 至多一次；
- 未知键 / 类型键并存 / 空 part / include 环 / layout 环或未知名 → 错误；
- 携带 running 策略的条目不能与后一条目共享物理页（要求自身 `break_before: page`，且不被后一条 `break_before: auto` 贴上来）。
