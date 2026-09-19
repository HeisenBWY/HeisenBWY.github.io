---
name: linux-kernel-blog
description: 为本仓库撰写、维护和呈现 Linux 内核技术博客文章，包括基于 openEuler 源码的研究、OS/内存管理知识地图更新、Hugo 阅读样式优化，以及在机制关系复杂时制作 Archify 图表。适用于 OS 专栏文章和专题导航；不用于独立内核调研报告归档。
---

# Linux Kernel Blog

为 `/home/wangyi/Grace0318.github.io` 维护结构统一、证据清楚、适合持续学习的 Linux 内核博客。Markdown 是文章事实来源，Hugo 是唯一站点渲染器。

## 本地上下文

- 博客文章：`content/posts/`
- OS 首页：`content/categories/os/_index.md`
- 内存管理知识地图：`content/os/memory/index.md`
- 文章模板：`layouts/_default/single.html`
- 全站样式：`static/css/style.css`
- openEuler 内核源码：`/home/wangyi/openEuler-kernel/`，默认只读分析

每次写源码文章都重新读取内核分支、提交和 Makefile 版本，不沿用旧文章记录的提交号。明确区分本地 openEuler 实现、上游 Linux 文档和一般性概念。

## 按任务读取说明

- 撰写、续写或审校文章时，读取 [references/article-workflow.md](references/article-workflow.md)。
- 修改文章模板、目录、代码块、表格或整体阅读视觉时，读取 [references/presentation.md](references/presentation.md)。
- 用户要求机制图，或一个概念存在三项以上依赖关系、流程分支或状态变化时，读取 [references/diagrams.md](references/diagrams.md)。简单关系用正文、表格或小型代码图示即可。

## 共同约束

- 围绕一个明确问题组织文章，先给读者心智模型，再进入源码细节。
- 事实、推断和待验证内容分开表达。没有运行实验时明确说明，不虚构输出、性能结果或调用路径。
- 源码引用给出仓库相对路径、关键符号和基线，不大段复制代码。
- 新文章默认 `draft: true`；用户明确要求发布或既有工作流已授权公开时才改为 `false`。
- 文章使用 `categories: ["OS"]`，设置准确的专题标签；属于已有专题时填写 `topic_page`。
- 创建文章后更新相应知识地图条目的 `article`，避免文章与导航脱节。
- 不用 Pandoc 生成博客文章的独立 HTML，不提交 Hugo 的 `public/`。
- 完成后运行 Hugo 构建、`git diff --check`，并验证文章、专题地图和目录锚点。

## 外部能力的边界

`html-report-skill` 提供阅读设计参考，不直接作为 Hugo 渲染器。只迁移适合本博客的排版原则，并保持当前暖白与墨绿视觉。

Archify 负责真正需要图示的架构、流程、时序、数据流和生命周期图。调用时遵守它自己的 `SKILL.md`、校验和交付流程；图的存在不能替代正文解释和源码证据。
