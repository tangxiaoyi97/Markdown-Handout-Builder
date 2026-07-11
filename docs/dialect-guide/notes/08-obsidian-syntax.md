---
title: "Obsidian 语法全参考"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/obsidian
---
# 08 · Obsidian 语法全参考

本章逐项列出方言模式支持的全部静态语法。可运行的对照成品见《Obsidian Markdown · 静态语法全覆盖》（`docs/obsidian-showcase/`，输出 `dist/showcase/`）。

## 内部链接（wikilinks）

| 写法 | 效果 |
|:--|:--|
| `[[Note]]` | 按第 06 章优先级解析；章内笔记 → 锚点，vault 文件 → 复制并链接 |
| `[[Note\|显示文本]]` | 自定义链接文本（表格单元格内写 `\\|`） |
| `[[Note#Heading]]` | 标题片段；构建前验证存在 |
| `[[Note#H2#H3]]` | 多级标题路径，按**层级后缀**匹配；优先章节正文而非嵌入副本 |
| `[[Note#^block-id]]` | 块引用片段 |
| `[[#Local Heading]]` | 同页标题 |
| `[Markdown 形](Note.md#Heading)` | 标准 Markdown 链接同样走 vault 解析（URL 编码可用） |
| `obsidian://…` | 协议链接原样保留 |

块标识符：段落行尾 `^id`（阅读视图与 PDF 中隐藏）；列表/整块可用**独立成行**的 `^id` 标注上方相邻块。

## 嵌入（transclusion 与附件）

| 写法 | 效果 |
|:--|:--|
| `![[Note]]` | 整篇嵌入：递归渲染（含其内部嵌入），环引用被拦截并警告 |
| `![[Note#Heading]]` | 只嵌入该标题区段（到同级下一标题为止） |
| `![[Note#^block-id]]` | 只嵌入该块（段落或列表） |
| `![[image.png]]` / `![[image.png\|640]]` / `![[image.png\|640x360]]` | 图片嵌入与尺寸 |
| `![[audio.mp3]]` | 原生 `<audio>` 控件；PDF 中渲染为标注文件名的占位卡片 |
| `![[clip.mp4\|480x270]]` | 原生 `<video>`；PDF 同上 |
| `![[doc.pdf#page=2#height=400]]` | 内嵌 PDF 查看器（页码/高度参数），附下载链接回退 |
| `![[map.canvas]]` / `![[table.base]]` | Canvas / Bases 打包为可访问的文件卡片 |

嵌入语义细节：被嵌入笔记的 frontmatter 剥离；脚注按「章 + 嵌入序号」命名空间化，多来源不冲突；**嵌入区段的标题不进入主目录与 PDF 书签**（降级为普通段落语义，锚点保留可链）；未列入结构的被嵌入笔记会被递归 `check`。

## Properties（frontmatter）

YAML frontmatter 按 `markdown.obsidian.properties` 展示。类型保真：

- 文本、数字原样；布尔 → 复选框；日期字符串原样；
- 列表（`aliases` / `tags` / `cssclasses` 及任意列表值）→ 独立 value 胶囊；**逗号分隔的标量**（`tags: a, b`）按 Obsidian 规则拆分；
- `tags` 值渲染为标签胶囊（属性表内**不带** `#`，与 Obsidian Properties UI 一致）；
- 值内 `"[[Note]]"` → 可点内部链接；URL → 外链；
- `cssclasses` 附加到本章 `<section>`；`aliases` 参与链接解析；
- 空 frontmatter（`---` 紧跟 `---`）合法且被吞掉；坏 YAML：check 报错、build 警告降级。

## 标签

`#tag`、`#嵌套/子标签`、`#带_下划线-连字符`、Unicode 与 emoji 均可；纯数字（如 `#1984`）不是标签。**识别边界与 Obsidian 一致**：`#` 必须位于行首或空白之后——紧贴标点（含全角 `：` `、`）不识别。正文标签渲染为带 `#` 的胶囊，并带 `data-tag` 供 CSS 定制。

## 注释

`%%行内注释%%` 与多行 `%%` 块从输出中移除（HTML 与 PDF 均不可见）；围栏代码与行内代码中的 `%%` 原样保留；`\%%` 转义可见。

## Callouts

```text
> [!note] 自定义标题（支持 **Markdown**）
> 正文同样是完整 Markdown。
```

- 全部官方类型及别名（note / abstract·summary·tldr / info / todo / tip·hint·important / success·check·done / question·help·faq / warning·caution·attention / failure·fail·missing / danger·error / bug / example / quote·cite），未知类型按自定义类型渲染并带 `data-callout` 钩子；
- 折叠：`[!type]+` 默认展开、`[!type]-` 默认折叠（HTML 用 `<details>`，PDF 保留标题呈现静态折叠态）；
- 任意层级嵌套；标题省略时用类型名的 Title Case。

## 任务列表

`- [ ]` 未完成；`- [x]` 完成、`- [-]` 取消（勾选 + 删除线弱化）；**任意自定义状态字符**（`[?]`、`[!]`、`[>]`……）在方框中直接展示该字符，语义不丢失；均带 `data-task` 供 CSS 定制；可与普通列表任意混排嵌套。

## Mermaid

````text
```mermaid
flowchart LR
  A["Start"] --> B["End"]
  class A,B internal-link;
```
````

构建时离线渲染为 SVG（运行时脚本随 `dist/assets/` 分发）；**PDF 管线等待全部图表完成后再分页**。flowchart 节点标注 `internal-link` class 时，节点文本按 vault 规则解析为文内链接（已有 `click` 声明的节点不覆盖）。

## 其余共享语法

标准方言的一切照常可用：GFM 表格与删除线、`==高亮==`、脚注（含行内脚注 `^[...]`，按章命名空间化）、KaTeX（行内/块级，`\tag{}` 编号）、构建期代码高亮、图片尺寸 `![alt|300x200](...)`、图注（独立成段图片的 title → `<figcaption>`）、`\pagebreak` / `\newpage` 手动分页、六级 ATX 标题稳定锚点。

## 静态边界（刻意不做的）

| 能力 | 处理方式 | 归类 |
|:--|:--|:--|
| `query` 围栏 | 保留源码展示，不执行搜索 | 核心插件 |
| Dataview 等插件语言 | 保留源码展示 | 社区插件 |
| Canvas / Bases 交互视图 | 文件卡片 + 打包源文件 | 独立文件格式 |
| 悬停预览、图谱、重命名联动、复选框点击等 | 不属于静态输出 | 应用行为 |

「全覆盖」的口径是 Obsidian 官方 **Obsidian Flavored Markdown** 扩展表 + 静态 properties / tags / Mermaid / 官方附件格式；应用级动态行为明确标注而不是模拟。
