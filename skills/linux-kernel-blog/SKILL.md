---
name: linux-kernel-blog
description: 为本仓库撰写、维护和呈现 Linux 内核技术博客文章，包括基于 openEuler 源码的研究、OS/内存管理知识地图更新、AnZhiYu 主题阅读样式优化，以及在机制关系复杂时制作 Archify 图表。适用于 OS 专栏文章和专题导航；不用于独立内核调研报告归档。
---

# Linux Kernel Blog

为 `/home/wangyi/HeisenBWY.github.io` 维护结构统一、证据清楚、适合持续学习的 Linux 内核博客。Markdown 是文章事实来源，Hexo + AnZhiYu 主题是站点渲染器。

## 本地上下文

- 博客文章：`source/_posts/`
- 草稿：`source/_drafts/`
- 内存管理知识地图：`source/os/memory/index.md`
- Hexo 主配置：`_config.yml`（permalink、skip_render、highlight 等站点级行为）
- AnZhiYu 主题配置：`_config.anzhiyu.yml`（导航、封面、代码块工具栏、社交图标等）
- 自定义样式：`source/css/custom.css`（行内代码、代码块 token 着色、架构图容器）
- 架构图：`source/diagrams/<article-slug>/`（skip_render 原样输出）
- 文章封面：`source/img/covers/`
- 文章骨架模板：`scaffolds/post.md`
- 部署：`.github/workflows/hexo.yml`（Node 22 + npm ci + hexo generate + GitHub Pages）
- openEuler 内核源码：`/home/wangyi/openEuler-kernel/`，默认只读分析

每次写源码文章都重新读取内核分支、提交和 Makefile 版本，不沿用旧文章记录的提交号。明确区分本地 openEuler 实现、上游 Linux 文档和一般性概念。

## 按任务读取说明

- 撰写、续写或审校文章时，读取 [references/article-workflow.md](references/article-workflow.md)。
- 修改主题配置、代码块、表格、封面或整体阅读视觉时，读取 [references/presentation.md](references/presentation.md)。
- 用户要求机制图，或一个概念存在三项以上依赖关系、流程分支或状态变化时，读取 [references/diagrams.md](references/diagrams.md)。简单关系用正文、表格或小型代码图示即可。

## 共同约束

- 围绕一个明确问题组织文章，先给读者心智模型，再进入源码细节。
- 事实、推断和待验证内容分开表达。没有运行实验时明确说明，不虚构输出、性能结果或调用路径。
- 源码引用给出仓库相对路径、关键符号和基线，不大段复制代码。
- 新文章默认放入 `source/_drafts/`；用户明确要求发布时才移入 `source/_posts/`。
- 文章使用 `categories: ["OS"]`，按内容设置准确标签；每篇在 front-matter 指定 `cover`。
- 创建文章后更新相应知识地图条目的链接，避免文章与导航脱节。
- 不提交 Hexo 的 `public/`（由 CI 生成）；不修改 `node_modules/` 下的主题文件，主题定制统一走 `_config.anzhiyu.yml` 与 `source/css/custom.css`。
- 完成后运行本地预览验证（`npx hexo server`），用真实浏览器检查文章、代码块、知识地图链接，再报告结果。除非用户授权，不提交、推送或发布。

## 外部能力的边界

AnZhiYu 主题自带大量功能（评论、音乐、说说等），默认只启用已在 `_config.anzhiyu.yml` 中开启的部分；新增功能前先确认用户是否需要。

Archify 负责真正需要图示的架构、流程、时序、数据流和生命周期图。调用时遵守它自己的 `SKILL.md`、校验和交付流程；图的存在不能替代正文解释和源码证据。
