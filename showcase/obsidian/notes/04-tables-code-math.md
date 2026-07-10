---
aliases:
  - Tables Code Math
tags:
  - showcase/advanced
status: Complete
---
# 05 · 表格、代码、脚注与数学

## Tables

表格支持对齐、内联格式、wikilink 与图片。表格中的 alias 分隔符需要写成 `\|`，以免和列分隔符冲突。

| 语法 | 示例 | 状态 |
|:--|:--|--:|
| Wikilink alias | [[Reference Library\|Reference alias]] | ✓ |
| 强调 / 高亮 | **bold** / ==mark== | ✓ |
| 嵌套标签 | #table/demo | ✓ |
| 数学 | $E=mc^2$ | ✓ |

## Code spans 与 fenced code

Inline code 保留字面量：`[[not a link]]`、`%% not a comment %%`、`#not-a-tag`。

~~~js
const dialect = {
  name: "obsidian",
  links: "[[Reference Library]]",
  comment: "%% preserved inside code %%"
};

console.log(dialect.name);
~~~

未知语言会安全回退为转义后的普通代码块：

~~~vault-config
markdown:
  dialect: obsidian
  obsidian:
    vault_root: "."
~~~

## Footnotes

命名脚注与数字脚注都会按章节命名空间化。这里引用一个脚注。[^compat]

Inline footnote 不需要单独定义。^[Inline footnotes 是 Obsidian reading view 支持的扩展形式。]

[^compat]: 这条脚注包含 **Markdown**、[[Reference Library|内部链接]] 与第二行内容。  
  缩进后的内容仍属于同一脚注。

## Math / LaTeX

行内公式：$F = ma$，矩阵：$\begin{vmatrix}a & b\\ c & d\end{vmatrix}=ad-bc$。

块公式使用 KaTeX，并保留作者手写的公式编号：

$$
\mathbf{F} = m \cdot \mathbf{a} \tag{5.1}
$$

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \tag{5.2}
$$

## Raw HTML

Obsidian 方言允许可信 Raw HTML；Markdown 不会在 HTML 元素内部二次解析，这与 Obsidian 行为一致。

<details open>
  <summary><strong>Trusted HTML details</strong></summary>
  <p>这里的 <code>**asterisks**</code> 保持字面量；HTML 标签由浏览器解释。</p>
</details>

## Lists 与 escaping

- 无序列表
  - 嵌套项目
    1. 有序子项
    2. 第二项
- 转义字符：\#not-a-tag、\*not emphasis\*、1\. not an ordered item
