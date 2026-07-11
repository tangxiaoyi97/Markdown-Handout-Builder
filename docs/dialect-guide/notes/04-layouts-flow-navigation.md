---
title: "Layouts、分页与导航"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/structure
---
# 04 · Layouts、分页与导航

## 命名 layouts

`layouts:` 定义可复用的**条目默认值包**。可用键与条目/`defaults` 一致：`extends`、`class`、`chapter_toc`、`toc`、`navigation`、`flow`、`running`。

```yaml
layouts:
  body:
    class: layout-body
    chapter_toc: true

  compact:
    extends: body              # 单继承；解析在渲染前完成
    class: layout-compact      # class 与父层取并集
    flow:
      break_before: auto       # 其余键逐字段覆盖

  no-footer:
    extends: body
    running:
      footer: false            # running 深合并（详见第 05 章）

structure:
  - type: chapter
    path: notes/short-note.md
    layout: compact
```

规则与校验：

- layout 名须匹配 `[A-Za-z_][A-Za-z0-9_-]*`；
- `extends` 引用未知名、继承成环 → **硬错误**（`check` 报出完整环路径）；
- 条目引用未知 layout → 硬错误；
- 合并语义：`class` 并集去重；`chapter_toc`、`flow.*`、`navigation.*` 逐字段后者覆盖前者；`running` 的 header / footer / style 深合并。

layout 管**策略与钩子**，不管字体字号——外观交给 CSS。构建产物给每个条目留了两个稳定钩子：生成的 class（`class:` 并集）与 `data-layout="<名>"` 属性，配合 `style.custom_css` 使用：

```css
.chapter[data-layout="compact"] h2 { margin-top: 1em; }
.layout-body .chapter-toc { border-left-color: #5f58b6; }
```

## flow —— 分页流

每个条目独立声明分页，取值均为 `page | auto`：

```yaml
  - type: chapter
    path: notes/appendix.md
    flow:
      break_before: page       # 默认：每个条目起新页
      break_after: auto        # 默认：不强制结束页
```

- `break_before: auto` 让本条目**紧跟上一条目排版**（如一组短插页连排）；
- `break_after: page` 强制本条目结束后翻页；
- 首个正文条目自动豁免起页断（紧随封面/目录，不出空页）；
- 携带 running 策略的条目必须 `break_before: page`，且其后条目不得以 `break_before: auto` 贴上来——一张物理页只能有一套页眉策略，`check` 会拦下违例组合；
- `break-before: recto/verso`（奇偶页起章）**刻意未提供**：当前 Chromium 打印忽略该属性，宁缺毋滥。需要右页起章时用 `blank:` 手工垫页。

## navigation —— 目录与书签归属

导航与分页正交，四个键：

```yaml
  - type: chapter
    path: notes/appendix.md
    navigation:
      toc: true                # 进主目录（false = 不进；锚点与书签保留）
      label: "附录 A"           # 主目录行文案（覆盖一级标题文本）
      level: 2                 # 主目录层级 1–6
      outline: true            # 是否进入 PDF 书签
```

- 紧凑形的 `toc: false` / `toc: "文案"` 是 `navigation.toc` / `navigation.label` 的简写；
- `level` 独立于 Markdown 标题深度：条目 `level: 2` 时，其章内 `h2` 在主目录中呈现为第 3 层，依此类推（part 的子条目自动获得「部层级 + 1」为基准）；
- **约束**：`outline: false` 目前要求同时 `toc: false`——真实目录页码靠 PDF 书签目的地映射，标题不进书签就无法回填页码；
- running 策略要求 `outline: true`（页区间映射同样依赖书签）。

## 主目录与每章小目录

全局配置（两者的行都带真实 PDF 页码回填）：

```yaml
toc:
  enabled: true                # false = 不生成主目录
  title: "目录"
  depth: 2                     # 收录层级 1–3

chapter_toc:
  default: false               # true = 每章默认开小目录
  title: "本章内容"             # "" 隐藏小标题
  depth: 3                     # 收录 h2..h<depth>
  class: my-chapter-toc        # 附加 class
```

每章小目录列出本章 `h2..depth` 级标题、插在一级标题之后，位于正文流内（恒计页）。条目/layout 的 `chapter_toc: true|false` 覆盖全局默认。
