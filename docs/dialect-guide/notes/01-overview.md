# 01 · 工具总览

## mhb 是什么

Markdown Handout Builder 把一组纯 Markdown 笔记构建成**两种成品**：

1. **自包含 HTML**（`dist/handout.html`）——阅读用，内联全部 CSS 与 KaTeX 字体引用，离线可用；
2. **官方 PDF**（`dist/handout.pdf`）——打印/分发用，由 Playwright Chromium 从同一份 HTML 打印生成，再经 pdf-lib / pdfjs 后处理（页码、书签、元数据、覆盖层）。

核心原则：**每份 PDF 只从对应的同一份 HTML 打印生成**，不存在第二套模板；HTML 与 PDF 的差异只来自打印介质与官方管线的后处理。

## 设计取向

- **内容与策略分离**。Markdown 里只有内容；顺序、分页、页眉页脚、目录归属全部在 `book.yml` 声明。排版策略（layouts）不是第二套样式语言——外观仍然交给 CSS。
- **不自动编号**。章节号、定理号、图号、公式号都由作者写在内容里（标题、环境名、图注、KaTeX `\tag{}`），所见即所得。
- **错误必须显式**。拼错的键、指错的路径、成环的继承在 `mhb check` 阶段就报错，绝不静默变成空白页。
- **默认严格、可移植**。默认方言是严格 Markdown（CommonMark + 常用扩展，禁 raw HTML）；Obsidian 方言按项目显式启用。

## dialects 版新增能力一览

| 能力 | 一句话 | 详见 |
|:--|:--|:--|
| `structure:` 结构语言 | `chapters:` 的书籍级替代：显式 `type:`、部（part）、包含（include） | 第 03 章 |
| 命名 layouts | 可继承、可复用的条目默认值包 | 第 04 章 |
| flow / navigation | 分页与目录/书签归属逐条目独立控制 | 第 04 章 |
| 每章 running 策略 | 单章关闭或改写页眉/页脚槽位与样式 | 第 05 章 |
| 声明式特殊页 | divider（篇章隔页，支持满版出血）、blank（空白页）、contents（目录布点） | 第 03 章 |
| Obsidian 方言 | wikilink、transclusion、properties、callouts、Mermaid…… 全静态语法 | 第 06–07 章 |
| `mhb inspect` | 打印归一化后的扁平文档流（`--json` 可机读） | 第 02 章 |
| `book.schema.json` | 随包分发的 JSON Schema，编辑器校验与补全 | 第 02 章 |

## 安装

要求：Node.js ≥ 20；渲染 PDF 需要 Playwright Chromium。

在笔记仓库中：

```bash
npm install -D markdown-handout-builder
npx mhb install-browser        # 安装本包锁定的 Chromium
```

新仓库可以直接生成脚手架：

```bash
npx markdown-handout-builder init
```

`init` 生成 `book.yml`（带 schema 头注释）、`notes/` 示例章节、`package.json` 脚本、`.gitignore`、GitHub Actions 工作流与 `WRITING_RULES.md`，已存在的文件会跳过（`--force` 才覆盖）。

## 仓库约定

```text
book.yml          # 唯一配置（或用 --config 指定别处）
notes/            # 正式内容；本地图片放 notes/assets/
  00-intro.md
  assets/
dist/             # 构建产物（HTML、PDF、index.html、复制的资源）
```

- 章节文件通常有且只有一个 `#` 一级标题：它是章名，进入主目录与 PDF 书签，也是每章 running 策略的页区间锚点。
- `notes/` 下未被结构收录且未被 transclusion 引用的 `.md` 会得到警告；文件名以 `_` 开头视为草稿，不提醒。
- `notes/assets/` 下未被引用的文件同样会被警告。

## 一条最小配置

```yaml
title: "My Handout"
language: "zh-CN"
chapters:
  - notes/00-intro.md
  - notes/01-topic.md
output:
  html: dist/handout.html
  pdf: dist/handout.pdf
```

除 `title`、`chapters` / `structure` 二选一、`output` 外，其余键全部可选。完整注释模板见包内 `book.example.yml`，全键速查见本书第 10 章。
