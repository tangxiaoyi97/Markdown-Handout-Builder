---
title: "官方 PDF 管线"
authors:
  - "Markdown Handout Builder"
created: 2026-07-11
modified: 2026-07-11
tags:
  - guide/pdf
---
# 10 · 官方 PDF 管线

`mhb pdf` 用 Playwright Chromium 打开各主题 HTML、切换打印介质渲染，再做 PDF 后处理。本章解释全部 `pdf.*` 配置与管线机制。

## pdf.* 配置全键

```yaml
pdf:
  header_footer: true          # 页眉页脚总开关（默认 true）
  toc_page_numbers: true       # 目录页码回填（默认 true）
  cover_header_footer: false   # 封面是否也带页眉页脚（默认 false）
  page_size: "A4"              # 传给 @page size（A3/A4/A5/B4/B5/letter/legal/ledger/tabloid 或显式尺寸）
  margin: "17mm 16mm 19mm 16mm"
  date_format: "YYYY.MM.DD"    # 仅页眉页脚的日期显示（缺省用全局 date_format）
  page_numbers:
    format: "{{page}} / {{total}}"   # 亦接受 x、x/x、page of total 等速记
    count_cover: false         # 封面不计页（保留页面，逻辑页码跳过）
    count_toc: false           # 目录不计页（流内目录恒计页，此键被忽略并警告）
    count_back_cover: false    # 封底不计页
  header:                      # 三槽位；每章可被 running 策略覆盖
    left: "{{title}}"
    center: ""
    right: "{{version}}"
  footer:
    left: "Markdown Handout Builder"
    center: "{{page}} / {{total}}"
    right: "{{date}}"
  header_footer_style:
    font_size: "8px"
    color: "#667085"
    font_family: "…"           # 缺省用内置跨平台栈（含 CJK）
    offset: "5mm"              # 垂直落点；缺省按边距 38% 计算并钳制 3–8mm
```

页眉页脚由 Chromium 画在**页边距区**（CSS `@page` 边距盒不可用是引擎限制），正文内容 100% 来自 HTML。

## 页码语义：物理页 vs 逻辑页

`count_cover / count_toc / count_back_cover: false` 把对应区段**保留在 PDF 里但不计页**。实现：管线打印两遍——「计页子集」（DOM 中移除被剔除区段，让 Chromium 只对计页部分编号）与「全量无页眉版」，再把被剔除区段的页面**拼接回**正确位置。因此：

- `{{page}} / {{total}}` 是逻辑页码；
- 被剔除区段的页面干净无页眉；
- 章节小目录始终在正文流内、恒计页；流内主目录（`contents:` 条目）同样恒计页。

## 目录页码回填

两遍打印：第一遍读取 PDF 书签得到每个标题的真实页码，注入主目录与全部章节小目录的 `.toc-page` 占位符（同行追加、不改变分页），第二遍出正式件。数量对不齐时按标题文本贪心对齐，失败则告警放弃回填而不是给错页码。

## 覆盖层机制（封面 / 封底 / 出血隔页 / running）

- **封面**：首页零边距满版；计页且带页眉配置时，用无页眉版同页整页覆盖，保证背景干净；
- **封底**：正文流内是普通页（保证分页与页码稳定），另做**仅封底的独立单页打印**（此时它是首页，天然满版），后处理整页覆盖到末页；
- **出血隔页**（`divider.bleed: true`）：同封底机制。目标物理页靠隔页标题的书签目的地定位；定位失败降级为正文区背景并警告；
- **running 策略**：见第 05–06 章——按页区间遮罩或以 Chromium 渲染的条带替换页眉/页脚，正文与链接注记不动。

全部覆盖层都发生在内容流之上，**书签、内链、目录页码一概保留**。

## 页面基底色

深色 / 纸感主题下，Chromium 打印的页边距底色与正文底色存在引擎级差异。官方管线解压每页内容流，把基底填充色改写为主题的打印底色（浅色主题则在流首插入整页底色），使页边距与正文浑然一体。Chromium 未来更改内容流格式时会**告警**而不是静默退化。

## 元数据与书签

- 元数据：Title（非默认主题附主题名）、Author(s)、Subject（subtitle）、Keywords、Creator、Producer、Language、创建/修改时间；
- 书签（outline）由全部标题生成：transclusion 副本的标题与 `navigation.outline: false` 的条目除外；
- `tagged: true` 生成带结构标签的 PDF（可访问性；书签与页码映射也依赖它）。

## 浏览器打印 vs 官方 PDF

| 维度 | 浏览器 Ctrl+P | 官方 `mhb pdf` |
|:--|:--|:--|
| 页眉页脚 | `<thead>` 运行页眉（无页码） | Chromium 模板 + 每章策略，逻辑页码 |
| 封底/出血隔页 | 铺满正文区 | 满版出血 |
| 目录页码 | 无 | 真实页码回填 |
| 计页剔除 | 无 | count_* 全支持 |
| 元数据/书签后处理 | 无 | 全套 |

需要正式分发时，永远使用官方 PDF。

## 已知边界

- 混合纸张尺寸/横竖版（每区段独立 `@page`）**刻意未做**：Chromium 命名页在文档中段不可靠（会产生尾随空白页），未来需要分段渲染-合并管线；
- `break-before: recto/verso` 被 Chromium 忽略，未暴露为配置。
