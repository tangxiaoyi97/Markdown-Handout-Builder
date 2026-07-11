---
title: "book.yml 全键参考"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/reference
---
# book.yml 全键参考

类型标注：`str` 字符串、`num` 数字、`bool` 布尔、`list` 列表、`map` 映射。**加粗**为必填。本章页眉即 running 策略的活演示（`reference` layout：页眉中位 = 章名）。

## 顶层元数据

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| **title** | str | — | 书名；进封面、页眉、HTML `<title>`、PDF 元数据 |
| subtitle | str | "" | 副题；进封面与 PDF Subject |
| language | str | zh-CN | HTML `lang` 与 PDF Language |
| date | str | 今天 | 原始日期（`{{rawDate}}`） |
| date_format | str | YYYY-MM-DD | 日期显示格式（ISO 预设或字面模式） |
| version | str/num | "" | 版次（如 `2.0-dialect`）；进封面/封底与 `{{version}}` |
| authors | str/list | [] | 作者；`{{authors}}` 全列 / `{{author}}` 第一位 |
| keywords | list | [] | PDF Keywords |

## 结构与输出

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| **chapters** | list/str | — | 紧凑文档流；或指向 `.yml` 清单文件。与 structure 二选一 |
| **structure** | list/str | — | 语义文档流（type/part/include/layouts 全能力） |
| layouts | map | {} | 命名条目默认值包；键为 layout 名 |
| **output.html** | str | dist/handout.html | HTML 输出（相对 book.yml） |
| **output.pdf** | str | dist/handout.pdf | PDF 输出；非默认主题自动插入 `.<name>` |

### 条目通用键（chapter / insert / divider / part 可用）

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| class | str | "" | 附加 CSS class（空格分隔多枚） |
| layout | str | — | 引用 layouts 名 |
| chapter_toc | bool | 全局默认 | 开章小目录（仅章节） |
| toc | bool/str | true | `navigation.toc` / `label` 简写 |
| navigation.toc | bool | true | 进主目录 |
| navigation.label | str | 标题 | 主目录行文案 |
| navigation.level | int 1–6 | 1（部内自动 +1） | 主目录层级 |
| navigation.outline | bool | true | 进 PDF 书签；false 须与 toc:false 同用 |
| flow.break_before | page/auto | page | 条目前分页 |
| flow.break_after | page/auto | auto | 条目后分页 |
| running | false/map | 继承全局 | 见第 05 章：header/footer 为 bool 或 left/center/right 槽位；style 为 font_size/color/font_family/offset；槽位可用 {{fm.*}} |
| meta | false/list | 全局 frontmatter.meta | 本章 byline 键序（见第 06 章） |
| cover | bool/map | — | 章节 cover 页：enabled/class/background/color/bleed/title/subtitle/meta（模板行）（见第 06 章） |

### 各类型专有键

| 条目 | 专有键 |
|:--|:--|
| path（chapter/insert） | **path**；`as`/`role`: chapter\|insert（.html 不可作 chapter） |
| divider | title（bleed 时必填）、subtitle、note、background、color、bleed |
| blank | `blank: true\|1–20`；长形另可 count/class/layout/flow |
| contents | 仅 `contents: true` / `type: contents`；全书至多一次 |
| part | divider 全键 + **children**（chapters/structure 同义）+ defaults（class/layout/chapter_toc/toc/navigation/flow/running） |
| include | **include**: 相对所在 YAML 的 `.yml` 路径（长形 `type: include` + path） |
| layouts.\<name\> | extends + 条目通用键（不含 path 类键） |

## 目录

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| toc.enabled | bool | true | 生成主目录 |
| toc.title | str | 目录 | 主目录标题 |
| toc.depth | int 1–3 | 2 | 收录层级 |
| chapter_toc.default | bool | false | 每章默认开小目录 |
| chapter_toc.title | str | In this chapter | 小目录标题；"" 隐藏 |
| chapter_toc.depth | int 2–6 | 3 | 小目录收录 h2..hN |
| chapter_toc.class | str | "" | 附加 class |

## pdf.*

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| pdf.header_footer | bool | true | 页眉页脚总开关（每章 running 可 opt-in 回来） |
| pdf.toc_page_numbers | bool | true | 目录页码回填 |
| pdf.cover_header_footer | bool | false | 封面也带页眉页脚（要求封面计页） |
| pdf.page_size | str | A4 | 纸张 |
| pdf.margin | str | 18mm 16mm 20mm 16mm | 页边距（CSS 简写） |
| pdf.date_format | str | 全局值 | 页眉页脚日期格式 |
| pdf.page_numbers.format | str | {{page}} / {{total}} | 页码格式（支持速记 x、x/x、page of total） |
| pdf.page_numbers.count_cover | bool | true | 封面计页 |
| pdf.page_numbers.count_toc | bool | true | 目录计页（流内目录恒计页） |
| pdf.page_numbers.count_back_cover | bool | true | 封底计页 |
| pdf.header.left/center/right | str | {{title}} / "" / {{date}} | 页眉槽位 |
| pdf.footer.left/center/right | str | "" / 页码 / "" | 页脚槽位 |
| pdf.header_footer_style.font_size | str | 8.5px | 页眉页脚字号 |
| pdf.header_footer_style.color | str | #8a919a | 颜色 |
| pdf.header_footer_style.font_family | str | 内置栈 | 字体 |
| pdf.header_footer_style.offset | str | 按边距计算 | 垂直落点 |

## style / cover / back_cover / themes / labels / markdown

| 键 | 类型 | 默认 | 说明 |
|:--|:--|:--|:--|
| style.accent_color | str | #111111 | 强调色 |
| style.content_width | str | 860px | 屏幕版心 |
| style.base_font_size | str | 16px | 屏幕字号 |
| style.print_font_size | str | 11pt | 打印字号 |
| style.fonts.body/heading/code | str | 内置栈 | 字体栈 |
| style.custom_css | str/list | — | 自定义 CSS（项目路径优先，回退包内） |
| cover.enabled | bool | true | 封面开关 |
| cover.background / color | str | — | 封面配色（颜色或渐变） |
| cover.html | str | 默认组件 | 自定义封面片段 |
| back_cover.enabled | bool | false | 封底开关（其余键同 cover） |
| themes[] | list | 单默认主题 | name（**必填**，进文件名）、label、default、style、cover、back_cover、pdf（嵌套键二层合并） |
| labels.\<key\> | str | 英文默认 | 覆盖内置标签文本；新键注册自定义容器（`pagebreak` 保留） |
| markdown.dialect | str | standard | standard \| obsidian |
| frontmatter.title_as_heading | bool | false | 无 h1 章节以 fm.title 注入一级标题 |
| frontmatter.meta | false/list | false | 全局 byline 键序（如 [authors, modified, tags]） |
| frontmatter.labels.\<key\> | str | created/modified 内置 | byline 与章节 cover 的字段标签 |
| frontmatter.dates.fallback_modified | str | none | none \| file（mtime 回退，CI 不可靠） |
| markdown.obsidian.vault_root | str | . | vault 根（相对 book.yml） |
| markdown.obsidian.properties | str | visible | visible \| hidden \| source |

## 占位符总表

| 占位符 | 可用范围 | 值 |
|:--|:--|:--|
| {{title}} {{subtitle}} | 页眉页脚、封面组件、插页 | 书名 / 副题 |
| {{authors}} {{author}} | 同上 | 全体作者 / 第一作者 |
| {{date}} {{rawDate}} | 同上 | 格式化 / 原始日期 |
| {{version}} {{lang}} | 同上 | 版次 / 语言 |
| {{commit}} | 同上 | 笔记仓库短 hash（脏树带 `-dirty`；非 git 为空） |
| {{theme}} | 页眉页脚 | 主题 label |
| {{page}} {{total}} | 页眉页脚、page_numbers.format | 逻辑页码 / 总页数 |
| {{chapterTitle}} {{sectionTitle}} | 每章 running 槽位 | 本章一级标题 |
| {{fm.\<key\>}} {{frontmatter.\<key\>}} | 每章 running 槽位、章节 cover 模板 | 本章 frontmatter 值（构建期解析；全局槽位禁用） |

未知占位符保留字面并在 `check` 警告。

## CLI 速查

| 命令 | 备注 |
|:--|:--|
| mhb init [--force] | 脚手架 |
| mhb check | 全量校验，错误退出码 1 |
| mhb inspect [--json] | 展平结构表 |
| mhb build | HTML + index + 资源 |
| mhb pdf | 官方 PDF |
| mhb serve [--port N] | 预览 + 监听重建 |
| mhb all | check + build + pdf |
| mhb install-browser / install-deps | Chromium / CI 依赖 |
| 全命令 --config \<file\> | 指定配置 |

编辑器校验：`# yaml-language-server: $schema=./node_modules/markdown-handout-builder/book.schema.json`。
