---
title: "Frontmatter 集成"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/frontmatter
---
# 06 · Frontmatter 集成

v3 把 frontmatter 提升为**方言无关的一等公民**：任何 Markdown 页的 YAML 头都会被剥离并解析（标准方言此前会把它字面泄漏进正文），其值可以驱动章节标题、标题下的 byline、每章页眉页脚，以及整页的章节 cover。Obsidian 方言的属性表（第 07 章）只是它的一种"展示"；本章讲"语义"。

## 全局配置

```yaml
frontmatter:
  title_as_heading: true       # 无 h1 的章节用 fm.title 注入一级标题
  meta: [authors, created, modified, tags]   # 章标题下的 byline（false/缺省 = 关）
  labels:                      # byline 与章节 cover 的字段标签
    created: "创建"
    modified: "更新"
  dates:
    fallback_modified: none    # "file" = modified 缺失时取源文件 mtime
```

## 规范化派生值

每章的 frontmatter 被规范化为一组派生值，`meta`、章节 cover 与 `{{fm.*}}` 共用：

| 派生键 | 取自 | 处理 |
|:--|:--|:--|
| `title` / `subtitle` | 同名键 | 文本 |
| `authors` / `author` | `authors` 或 `author` | 列表拼接 " , " / 第一位 |
| `created` | `created` 或 `date` | 按 `date_format` 格式化 |
| `modified` | `modified` 或 `updated` | 同上；可选 mtime 回退 |
| `tags` | `tags` | 逗号标量拆分、去 `#` |
| `status` | `status` | 文本 |

其余任意键原样进入 `{{fm.<key>}}` 值表（列表以 ", " 连接、布尔与数字转文本、日期样式的字符串按 `date_format` 格式化）。

::: warning
`dates.fallback_modified: file` 在 CI 里通常不可靠——checkout 的文件 mtime 是克隆时间。建议由编辑器插件把 `modified` 写进 frontmatter，回退只作为本地兜底。
:::

## 标题注入（title_as_heading）

`title_as_heading: true` 时，**没有一级标题**的章节会以 `fm.title` 注入 `# 标题`：锚点、主目录行、PDF 书签、running 页区间锚点全部照常生成。已有 h1 的章节不受影响。这让「纯 frontmatter 笔记」（常见于 Obsidian 工作流）无需改写正文即可成章。

## 章标题下的 byline（meta band）

`frontmatter.meta` 指定键序，逐条目可用 `meta: false` 关闭或 `meta: [键…]` 覆盖（可放进 layouts / part defaults 继承）：

```yaml
structure:
  - type: chapter
    path: notes/01.md
    meta: [authors, modified]    # 本章只显示作者与更新时间
```

渲染为 `<div class="hb-chapter-meta">`：`tags` 显示为胶囊（`.hb-tag`），`authors` 为名单，其余键按 `labels` 加前缀。空值自动跳过；整条为空则不渲染。插页（insert）不带 byline。

## 页眉页脚联动（{{fm.*}}）

每条目的 running 槽位可以引用**本章** frontmatter 的任意键，在构建期解析：

```yaml
layouts:
  draft-footer:
    running:
      footer:
        left: "{{fm.status}}"
        right: "{{fm.owner}} · 更新 {{fm.modified}}"
```

- `{{fm.<key>}}`（`{{frontmatter.<key>}}` 同义）只在**每条目 running 策略**与**章节 cover 模板**中有意义；写进全局 `pdf.header/footer` 会被 `check` 拦下（全局槽位无章可取值）；
- 缺失的键渲染为空并在构建时告警一次；
- 与 `{{page}}` / `{{chapterTitle}}` 等占位符自由混用（它们仍由官方 PDF 管线按页解析）。

## 章节 cover 页

`cover:` 给单章生成一整页的前置封面，内容默认取自 frontmatter：

```yaml
  - type: chapter
    path: notes/04-embeds.md
    cover:
      background: "linear-gradient(150deg, #2c2440, #a35d7c)"
      color: "#ffffff"
      bleed: true               # 官方 PDF 满版出血
      # title: "{{fm.title}}"   # 缺省：fm.title，再回退章 h1
      # subtitle: "{{fm.subtitle}}"
      # meta:                   # 缺省：作者行 + 创建/更新行 + 标签胶囊
      #   - "{{fm.authors}}"
      #   - "更新 {{fm.modified}}"
      class: my-cover           # 样式钩子（.hb-chapter-cover）
```

- 简写 `cover: true` 全默认；`cover: false` 显式关闭继承来的配置；可放进 layouts / part defaults 让整部章节统一带 cover；
- cover 恰占一页（divider 同款版式与保障）；`bleed: true` 复用封底/隔页的独立打印 + 整页覆盖机线，目标页 =「章 h1 所在页的前一页」，因此要求本章有一级标题（或开启 `title_as_heading`）且 `navigation.outline: true`；
- cover 的标题**不是**真实 h1：书签与目录仍属于正文一级标题，不会出现重复条目；
- 仅章节（`type: chapter`）可带 cover；raw-HTML 插页没有 frontmatter。

## 与 Obsidian 属性表的分工

Obsidian 方言的 `properties: visible` 展示**全部**原始键（忠实于 Obsidian UI）；`frontmatter.meta` 展示**精选**派生值。两者可并存，但通常二选一：面向 vault 校对用属性表，面向出版用 byline + cover（此时设 `properties: hidden`）。

::: tip
`mhb inspect` 不显示 fm 值（它们按章而异），但 RUNNING 列会体现槽位改写（`*H` / `*F`）。构建时的告警会精确指出缺失的 fm 键与所在文件。
:::
