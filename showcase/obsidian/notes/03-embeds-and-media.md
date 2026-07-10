---
aliases:
  - Embeds and Media
tags:
  - showcase/embeds
cssclasses:
  - media-demo
status: Complete
---
# 04 · 笔记与媒体嵌入

Obsidian 使用感叹号前缀把内部链接变成嵌入。构建器会复制所有引用附件到成品目录，使 HTML 与 PDF 构建保持离线、可复现。

## Image embeds

Wikilink 图片支持宽度与宽高：

![[attachments/obsidian-pipeline.svg|720x315]]

标准 Markdown 图片同样支持 Obsidian 的 `alt|width` 形式，并把 title 作为图注：

![Prism mark|150](../attachments/prism-mark.svg "Figure 1 · Standard Markdown image with Obsidian sizing")

## Whole-note transclusion

下面整篇嵌入一个未列入 chapters 的笔记；它会被递归检查，但不会额外成为手册章节。

![[Transclusion Source]]

## Heading / block / list transclusion

只嵌入目标标题区段：

![[Reference Library#Canonical Heading]]

只嵌入一个段落块：

![[Reference Library#^fact-block]]

只嵌入一个结构化列表：

![[Reference Library#^reference-list]]

## Audio embed

真实 WAV 附件使用浏览器原生 controls；PDF 保留静态控件外观和附件语义。

![[attachments/showcase-tone.wav]]

## Video embed

真实 MP4 附件带宽高参数，HTML 可播放，PDF 捕获首帧：

![[attachments/showcase-loop.mp4|480x270]]

## PDF embed

`#page=N` 与 `#height=N` 可同时使用：

![[attachments/reference-card.pdf#page=1#height=260]]

## Canvas 与 Bases

Canvas 和 Bases 是独立文件格式而不是 Markdown。静态手册将它们打包并显示为可访问文件卡片：

![[attachments/knowledge-map.canvas]]

![[attachments/library.base]]

> [!info] 静态输出边界
> Canvas/Bases 的交互式应用视图不会在 PDF 中伪造；文件本体被保留并可从 HTML 成品访问。

