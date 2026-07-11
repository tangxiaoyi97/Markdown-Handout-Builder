---
title: "命令行与流水线"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/cli
---
# 02 · 命令行与流水线

所有命令均可用 `mhb <命令>` 或 `npx markdown-handout-builder <命令>` 调用；`mdhb` 是等价别名。默认读取当前目录的 `book.yml`，任何命令都接受 `--config <file>` 指向别处。

## 命令总表

| 命令 | 作用 |
|:--|:--|
| `mhb init` | 生成最小笔记仓库脚手架（`--force` 覆盖已存在文件） |
| `mhb check` | 校验配置、文档结构、本地资源与方言语法/链接 |
| `mhb inspect` | 打印归一化后的文档结构（`--json` 输出机读 JSON） |
| `mhb build` | 渲染 `dist/handout.html`、主题变体与 `dist/index.html` |
| `mhb pdf` | 从已生成的 HTML 打印官方 PDF（`render-pdf` 同义） |
| `mhb serve` | 本地预览 + 保存即重建 HTML（`--port` 指定端口，默认 8000） |
| `mhb all` | 依次执行 check、build、pdf |
| `mhb install-browser` | 安装本包锁定版本的 Playwright Chromium |
| `mhb install-deps` | 在 CI（Linux）安装 Chromium 系统依赖 |

推荐把它们映射为 npm scripts（`init` 已代劳）：`npm run check / build / pdf / serve / all`。

## check：构建前把关

`mhb check` 汇总报告**全部**错误（`✗`）与警告（`⚠`），任一错误即退出码 1：

- `book.yml` 存在、可解析、顶层是映射；
- `structure` / `chapters` 归一化成功：文件存在、扩展名可识别、layout / part / include 合法、flow / navigation / running 策略约束满足；
- 章节内本地图片存在（相对章节文件解析）；
- 标准方言拒绝 Obsidian 专有语法（围栏与行内代码除外）；Obsidian 方言则解析 vault，逐一验证 wikilink / embed 目标与片段，递归检查被 transclusion 的笔记，报告歧义目标；
- `toc` / `chapter_toc` / `pdf` / `themes` / `labels` / 封面封底组件 / custom_css 路径等配置类型校验；
- 警告：未收录的 `notes/*.md`、未引用的 `notes/assets/*`、未知占位符、被忽略的组合（如流内目录 + `count_toc: false`）。

## inspect：先看展平结果再渲染

`structure` 支持部嵌套与递归包含，`mhb inspect` 打印**展平后的最终序列**与每条目继承解析后的策略：

```text
Document structure (13 entries, source: structure)
#   TYPE     ROLE     LAYOUT     BEFORE  AFTER  TOC              OUTLINE  RUNNING   SOURCE
1   insert   insert   -          page    auto   no               yes      +H/+F     notes/00-preface.md
2   contents contents -          -       -      -                yes      +H/+F     -
3   divider  part     -          page    auto   第一部分 · 总览   yes      +H/+F     第一部分 · 总览
4   chapter  chapter  body       page    auto   yes              yes      +H/+F     notes/01-overview.md
...
13  chapter  chapter  reference  page    auto   book.yml 全键参考 yes      *H/+F     notes/10-config-reference.md
```

RUNNING 列的记号：`+H/+F` 继承全局页眉/页脚；`-H` / `-F` 该章关闭；`*H` / `*F` 槽位被改写；末尾 `/S` 表示 style 有覆盖。`--json` 输出同等信息的 JSON，适合脚本消费。

## build：唯一 HTML 渲染源

`mhb build` 按归一化文档流渲染 Markdown，产出：

- `dist/handout.html` —— 默认主题成品（print.css 与 KaTeX CSS 内联）；
- `dist/handout.<theme>.html` —— 每个非默认主题一份变体；
- `dist/index.html` —— 落地页（含各主题入口与章节直达）；
- 复制 `notes/assets/` → `dist/assets/`、KaTeX 字体 → `dist/assets/katex-fonts/`、`THIRD_PARTY_NOTICES.md`；Obsidian 方言另复制被引用的 vault 附件 → `dist/vault/`，用到 Mermaid 时复制 `mermaid.min.js`。

## pdf：官方打印管线

`mhb pdf` 打开各主题 HTML，切换打印介质渲染 PDF。页码回填、计页剔除、封面/封底/出血覆盖、每章 running 策略、元数据与书签的完整机制见第 10 章。

## serve：本地预览

零依赖静态服务器托管 `dist/`，并监听：`book.yml`、`notes/`、本地模板、外部 structure 文件与**全部递归 include 文件**（构建成功后自动刷新监听清单）。保存即重建 HTML 并自动刷新浏览器；PDF 刻意保持手动（较慢）。

```bash
npm run serve -- --port 8000
```

## 编辑器校验：book.schema.json

包内随附 `book.schema.json`。在 `book.yml` 首行加一条注释，即可在 VS Code（YAML 扩展）等编辑器中获得键名补全与类型校验：

```yaml
# yaml-language-server: $schema=./node_modules/markdown-handout-builder/book.schema.json
```

`mhb init` 生成的配置已带此头。

## 典型 CI

`init` 生成的工作流：装依赖 → `mhb install-browser -- --with-deps chromium` → 装 CJK 字体 → `check + build + pdf` → 上传产物 / 部署 Pages。要点：CI 里 PDF 渲染完全可行，Chromium 建议按 Playwright 版本缓存。
