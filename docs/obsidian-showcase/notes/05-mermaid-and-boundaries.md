---
aliases:
  - Mermaid and Boundaries
tags:
  - showcase/mermaid
status: Complete
---
# 06 · Mermaid 与静态边界

## Flowchart + internal-link

Mermaid 在 HTML 中离线转换为 SVG；PDF 管线会等待图表完成后再分页。带 `internal-link` class 的 flowchart 节点会解析为 vault 内部链接。

~~~mermaid
flowchart LR
  A["Start Here"] --> B["Tasks and Callouts"]
  B --> C["Embeds and Media"]
  C --> D["Reference Library"]
  class A,B,C,D internal-link;
~~~

## Sequence diagram

~~~mermaid
sequenceDiagram
  participant V as Vault
  participant C as mhb check
  participant H as HTML
  participant P as PDF
  V->>C: Markdown + attachments
  C->>H: resolved dialect tokens
  H->>P: rendered SVG + print CSS
  P-->>V: portable showcase
~~~

## Search query fence

Obsidian Search 是 core plugin 的动态能力，不属于 Obsidian Flavored Markdown 扩展表。Showcase 保留其源码，但不会伪造实时搜索结果：

~~~query
tag:#showcase path:notes
~~~

## Dataview fence

Dataview 是社区插件语言，同样只作为代码展示：

~~~dataview
TABLE status, created
FROM #showcase
SORT file.name ASC
~~~

## 覆盖边界

| 能力 | 静态 PDF 行为 | 分类 |
|:--|:--|:--|
| Wikilinks / embeds / blocks | 完整解析与验证 | Obsidian Markdown |
| Callouts / tasks / comments | 完整静态渲染 | Obsidian Markdown |
| Properties / tags / Mermaid | 结构化或 SVG 输出 | 官方静态内容 |
| Search query | 保留源码，不执行 | Core plugin |
| Dataview | 保留源码，不执行 | Community plugin |
| Canvas / Bases | 打包为文件卡片 | 独立文件格式 |

<p class="showcase-status"><strong>Coverage statement:</strong> 本成品覆盖 Obsidian Flavored Markdown 官方扩展表以及 properties、tags、Mermaid 和官方附件类型；应用级动态行为被明确标注，而不是模拟。</p>

