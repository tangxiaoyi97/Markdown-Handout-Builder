# 08 · 主题、样式与封面

## style —— 全局样式入口

```yaml
style:
  accent_color: "#5f58b6"      # 链接与强调色（--hb-accent）
  content_width: "920px"       # 屏幕阅读最大宽度
  base_font_size: "16px"       # 屏幕字号
  print_font_size: "10.5pt"    # PDF / 打印字号
  fonts:
    body: '"Source Han Sans SC", sans-serif'
    heading: 'Georgia, "Source Han Serif SC", serif'
    code: 'ui-monospace, Menlo, monospace'
  custom_css: showcase.css     # 字符串或数组；最后内联，优先级最高
```

`custom_css` 路径先按项目目录解析，找不到再回退到包内（因此可以直接写 `templates/theme-clay.css` 引用内置主题皮肤）。

## 内联 CSS 的组装顺序（公开契约）

```text
KaTeX CSS → print.css（包内基础） → book.yml 覆盖（:root 变量 + @page） → custom_css
```

后者胜。`book.yml` 的样式类键都会翻译成 `:root` CSS 变量，自定义 CSS 用同名变量即可精确覆盖。

## 常用 CSS 变量与钩子

| 变量 / 钩子 | 含义 |
|:--|:--|
| `--hb-accent` | 强调色 |
| `--hb-content-width` / `--hb-base-font-size` / `--hb-print-font-size` | 版心与字号 |
| `--hb-font-body` / `--hb-font-heading` / `--hb-font-code` | 字体栈 |
| `--hb-page-margin-top/right/bottom/left` | 页边距镜像（封面/封底/隔页定位用） |
| `--hb-page-height` | 页高镜像（特殊页恰占一页的计算基准） |
| `--hb-cover-bg` / `--hb-cover-color` / `--hb-back-bg` / `--hb-back-color` | 封面/封底配色 |
| `.chapter` / `.insert` / `.hb-divider` / `.hb-blank` | 条目类型钩子 |
| `data-chapter` / `data-entry` / `data-layout` | 条目定位钩子 |
| `.callout[data-callout="…"]`、`.obsidian-tag[data-tag="…"]`、`.task-list-item[data-task="…"]` | 方言元素钩子 |

## themes —— 多主题输出

```yaml
themes:
  - name: light                # 进入文件名，须匹配 [A-Za-z0-9][A-Za-z0-9_-]*
    label: "Light"
    default: true              # 默认主题使用标准文件名；其余为 handout.<name>.*
  - name: dark
    label: "Dark"
    style:                     # 每主题可覆盖 style / cover / back_cover / pdf
      accent_color: "#eaeaea"
      custom_css: templates/theme-dark.css
    pdf:
      header_footer_style:
        color: "#9a9a9a"
```

- 每个主题产出一对 `html/pdf` 变体，`dist/index.html` 落地页自动列出全部入口；
- `pdf` 的嵌套键（`page_numbers` / `header` / `footer` / `header_footer_style`）做二层合并——主题只写其中一键时不丢基础配置；
- 包内置四套皮肤可直接 `custom_css` 引用：`theme-dark.css`、`theme-sepia.css`、`theme-clay.css`、`theme-academic.css`；
- 深色/纸感主题的页边距底色由官方管线统一改写（见第 09 章「页面基底色」）。

## labels —— 标签文本与自定义容器

```yaml
labels:
  note: "说明"                 # 覆盖内置显示文本
  tip: "提示"
  warning: "注意"
  danger: "危险"
  theorem: "定理"
  definition: "定义"
  example: "示例"
  exercise: "练习"
  keypoint: "要点"             # 新键 = 注册自定义容器 ::: keypoint
```

- 内置告示块：`::: note / tip / warning / danger`，冒号后可写自定义标题；
- 学术环境：`::: theorem / definition / example / exercise 名称`——不自动编号，编号写在名称里（如 `::: theorem 3.1 柯西不等式`）；
- `labels` 的新键注册为自定义容器（tip 样式基底 + `admonition-<key>` class 供 CSS 定制）；`pagebreak` 为保留字。

## 封面与封底

```yaml
cover:
  enabled: true                # 默认 true
  background: "linear-gradient(145deg, #f4f0e7, #e8edf7)"   # 颜色或渐变
  color: "#25304a"
  html: front/cover.html       # 可选：自定义组件片段（占位符已填充）

back_cover:
  enabled: true                # 默认 false
  background: "linear-gradient(145deg, #25304a, #4a4d86)"
  color: "#ffffff"
  html: front/back.html
```

- 默认组件展示 title / subtitle / authors / date / version；自定义 `html:` 片段与模板同级受信；
- 封面永远满版出血（首页零边距）；封底在官方 PDF 中由「独立单页打印 + 整页覆盖」实现满版（浏览器直接打印时铺满正文区）；
- 主题可分别覆盖 `cover` / `back_cover`。

## 网页端形态

构建出的 HTML 自带屏幕工具条（返回 index、下载官方 PDF、打印按钮）、浏览器打印用的运行页眉（`<thead>` 跨页重复；官方管线自动隐藏之以免双页眉）与键盘 `Ctrl/Cmd+P` 拦截。这些均为 `screen-only`，不进入 PDF。
