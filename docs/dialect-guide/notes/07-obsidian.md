---
title: "Obsidian 方言"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/obsidian
---
# 07 · Obsidian 方言：启用与解析模型

Obsidian 方言让 mhb 直接从一个 Obsidian vault 出版：wikilink、transclusion、properties、callouts、标签、Mermaid 与官方附件类型全部静态渲染进 HTML 与 PDF。**默认不启用**——默认方言保持严格、可移植的 Markdown。

## 启用

```yaml
markdown:
  dialect: obsidian            # "standard"（默认）或 "obsidian"
  obsidian:
    vault_root: "."            # vault 根目录，相对 book.yml；默认 "."
    properties: visible        # frontmatter 展示：visible | hidden | source
```

- `properties: visible`——每章顶部渲染 Obsidian 风格的属性表；`hidden`——解析但不展示；`source`——以 YAML 源码块展示。
- **信任模型**：Obsidian 模式与 Obsidian 本体一致，放行 raw HTML。只对受信内容启用本方言。
- 标准方言下，正文出现 `[[wikilink]]` / `![[embed]]`（围栏与行内代码之外）会被 `check` 拒绝并提示改写为标准语法。

## vault 索引

启用后，`vault_root` 被一次性扫描建立索引：

- **收录扩展名**：`.md`、`.base`、`.canvas`、`.pdf`，图片（avif/bmp/gif/jpeg/jpg/png/svg/webp）、音频（flac/m4a/mp3/ogg/wav/webm/3gp）、视频（mkv/mov/mp4/ogv/webm）；
- **跳过**：`.git`、`.obsidian`、`node_modules`、`dist` 及一切点开头目录；
- 每个 `.md` 的 frontmatter 被解析：`aliases`（含逗号分隔标量形）进入别名索引，`cssclasses` 应用到章节 `<section>`，坏 YAML 在 `check` 报错（章节）或警告（vault 其他笔记），构建时降级为无属性渲染。

## 链接解析优先级

`[[目标]]` 按以下顺序解析，全部大小写不敏感、Unicode NFKC 归一：

1. **精确 vault 路径**（含或不含 `.md` 后缀）；
2. **相对当前笔记的路径**；
3. **文件名 / 别名**：候选按目录距离（与当前笔记的最近公共祖先）排序，最近者胜；**等距歧义**取字典序最先者，并在 `check` 与构建时给出警告（写明选中了谁）。

解析失败 → `check` 报错（含行号）；构建仍会完成，未解析链接渲染为带下划线点线的 `unresolved` 样式并告警。

## 目标去向

- 链到**已收录章节**的笔记 → 文内锚点（`#章节标题`），跨章前向链接在全部章节渲染完成后统一回填；
- 链到**未收录**的 vault 笔记/附件 → 文件复制到 `dist/vault/<相对路径>` 并按源文件链接；
- 标题片段 `[[笔记#标题]]`、多级 `[[笔记#H2#H3]]`（按层级后缀匹配，优先正文本体而非 transclusion 副本）、块片段 `[[笔记#^block-id]]` 都在**构建前验证存在性**。

## check 在方言下的深度校验

- 每条 wikilink / embed 的目标与片段存在性（含表格里 `\|` 转义形）；
- 递归进入被 transclusion 的笔记继续校验（环安全）；
- 歧义目标警告；`vault_root` 不存在、`properties` 非法取值等配置错误；
- 未收录且未被嵌入的 `notes/*.md` 警告（`_` 前缀豁免）。

## 与结构语言的关系

方言与第 03–06 章的结构与 frontmatter 能力完全正交：Obsidian 书同样可用 `structure:`、layouts、divider、running 策略——本仓库的《Obsidian 语法 Showcase》即混用两者（方言 + 出血隔页）。
