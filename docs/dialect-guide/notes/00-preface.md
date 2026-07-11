---
title: "前言"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/showcase
---
# 前言

这是 **Markdown Handout Builder（mhb）Dialects 版**的完全指南，覆盖本版次的**全部功能与全部配置项**：从命令行流水线、`structure:` 文档结构语言、layouts / parts / includes、每章页眉页脚策略，到 Obsidian 方言的完整语法支持、主题系统与官方 PDF 打印管线。

## 版次与对应关系

| 对象 | 版次 | 说明 |
|:--|:--|:--|
| npm 包 `markdown-handout-builder` | `2.3.0-beta.1` | dialects 分支预发布，`next` dist-tag |
| 本指南（文档版次） | `3.0-dialect` | 与 Obsidian 语法 Showcase 同版次 |
| 使用手册（原版功能） | `2.0` | `docs/handbook/`，英文 |

## 如何阅读

- **第一次使用**：读第一部分（总览与命令行），跑通 `check → build → pdf`。
- **要排一本书**：读第二部分（文档结构语言），它是本版次的核心能力。
- **从 Obsidian vault 出版**：读第三部分，配合成品《Obsidian Markdown · 静态语法全覆盖》对照验证。
- **查配置**：直接翻最后一章《book.yml 全键参考》，全部键、类型、默认值一页速查。

本书自身就是用它所讲解的能力排版的：`structure:` 长写法、layouts 继承、五个满版出血的篇章隔页、流内目录、每章标题下的 frontmatter byline、第 08 章的出血章节 cover，以及参考章的独立页眉页脚策略（页脚右位即 `{{fm.modified}}`）。仓库里的 [docs/dialect-guide/book.yml] 即为可运行的完整示例。

::: note
本指南描述 dialects 版行为。凡与原版（2.0）不同之处，正文中都会标注「dialects 版新增」。
:::
