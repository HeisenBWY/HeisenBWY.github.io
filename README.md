# HeisenBWY · 技术笔记

使用 [Hexo](https://hexo.io/) + [AnZhiYu 主题](https://github.com/anzhiyu-c/hexo-theme-anzhiyu) 的中文个人博客。网址：https://heisenbwy.github.io/ 。

## 本地预览

需要 Node.js 20+。在此目录运行：

```bash
npm install
npx hexo server
```

打开 http://localhost:4000/ 。若在远程开发环境中运行，需要转发 4000 端口。

## 目录结构

- `_config.yml`：Hexo 主配置（站名、链接格式等）
- `_config.anzhiyu.yml`：主题配置（导航、侧栏、首页顶部、封面等），改动主题相关内容优先改这里
- `source/_posts/`：文章
- `source/_drafts/`：草稿（`hexo new draft 标题`，发布时移到 `_posts` 或用 `hexo publish`）
- `source/about/`、`source/tags/`、`source/categories/`、`source/os/memory/`：关于、标签、分类、内存管理知识地图页
- `source/img/`：头像、封面、横幅等图片
- `source/css/custom.css`：自定义样式（文章内交互架构图容器等）
- `source/diagrams/`：archify 导出的交互架构图，文章中通过 iframe 嵌入
- `diagram-sources/`：架构图源文件

## 写新文章

```bash
npx hexo new post "我的新笔记"
```

编辑 `source/_posts/我的新笔记.md`，front matter 中常用字段：

```yaml
title: 标题
date: 2026-10-02 12:00:00
tags: [Linux]
categories: [OS]
description: 摘要
cover: /img/cover.jpg   # 不填则使用默认封面
```

文章内提示框使用主题 note 标签：

```markdown
{% note info no-icon %}
**标题**

内容
{% endnote %}
```

OS 与 Linux 内核文章的完整研究、证据和版本比较规范见 `skills/linux-kernel-blog/SKILL.md` 与 `skills/linux-kernel-blog/references/article-workflow.md`。源码文章默认从上游 `v6.6` 基础机制出发，分别检查 6.6.y 稳定修复、openEuler OLK-6.6 增量和 6.6 之后的上游演进；只展开会影响主题结论的重要变化。

## 发布到 GitHub

1. 源码提交到 `main` 分支（包含 `.github/workflows/hexo.yml`），不要上传 `public/` 和 `node_modules/`（已在 `.gitignore` 中）。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送到 main 自动构建发布；也可在 **Actions → Build and deploy blog → Run workflow** 手动触发。
