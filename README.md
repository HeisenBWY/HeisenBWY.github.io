# HeisenBWY · 技术笔记

使用 Hugo 的中文个人博客，独立模板，无第三方主题依赖。网址：https://heisenbwy.github.io/ （部署成功后可访问）。

## 本地预览

安装 Hugo 0.166.0 或兼容版本，在此目录运行：

```bash
hugo server -D --bind 127.0.0.1
```

打开 http://localhost:1313/ 。若在远程开发环境中运行，需要转发 1313 端口。

当前机器已下载独立 Hugo 程序，也可以直接使用，无需全局安装：

```bash
cd /home/wangyi/Grace0318.github.io
./.tools/hugo/hugo server -D --bind 127.0.0.1
```

## 发布到 GitHub

1. 使用已创建的仓库 `https://github.com/HeisenBWY/HeisenBWY.github.io`。
2. 把本目录源码提交到该仓库的 `main` 分支，包括 `.github/workflows/hugo.yaml`，不要上传 `public` 或 `.tools`。
3. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 在 **Actions → Build and deploy blog → Run workflow** 触发发布；后续推送到 main 会自动发布。
5. 等部署成功后，访问 https://heisenbwy.github.io/ 。

如果本目录尚未初始化 Git，可以运行（需要自己已完成 GitHub 身份验证）：

```bash
git init -b main
git add .
git commit -m "Create personal technical blog"
git remote add origin https://github.com/HeisenBWY/HeisenBWY.github.io.git
git push -u origin main
```

## 写新文章

```bash
hugo new content posts/my-new-note.md
```

编辑生成的 Markdown 文件，填写标题、简介、标签和正文。准备公开时，把 `draft: true` 改成 `draft: false`，提交并推送。

文章列表默认使用 CSS 技术封面。可以在 front matter 中设置封面主题和缩写：

```yaml
cover_theme: memory-map
cover_symbol: MM
```

如果有自己的封面图片，把图片放在 `static/images/covers/`，再设置 `cover: /images/covers/文件名.webp`；列表卡片会自动使用图片。

`hugo server -D` 会展示草稿；正式构建不会发布草稿和未来日期文章。公开仓库里的草稿源文件仍可被他人看到，私人笔记应放在仓库之外。

## 专栏

已设置 OS、AI 和论文三个专栏。在文章开头的 YAML 配置中添加 `categories: ["OS"]`、`categories: ["AI"]` 或 `categories: ["papers"]`，文章就会出现在对应专栏中（`papers` 在页面上显示为“论文”）。跨主题文章可以填写 `categories: ["AI", "papers"]`。标签仍使用 `tags`，可自由细分。

专栏介绍位于 `content/categories/` 下的 `os`、`ai` 和 `papers` 目录。没有文章时，专栏显示空状态，不会自动加入示例文章。

OS 首页使用专题导航布局，专题名称、简介、标签和当前主线在 `content/categories/os/_index.md` 的 `topics` 中维护。文章同时设置 `categories: ["OS"]` 和相应专题的标签（例如 `tags: ["Linux", "内存管理"]`），就会自动出现在对应专题下，按日期从早到晚排列；草稿只在草稿预览中显示。多个专题标签会让文章出现在多个专题中。添加新专题时，在 `topics` 中增加唯一 `id` 和对应 `tag`。展示模板为 `layouts/partials/os-hub.html`。

内存管理知识地图位于 `content/os/memory/index.md`，访问路径为 `/os/memory/`。在 front matter 的 `modules` 中维护模块，每个 `questions` 条目填写 `title`：默认显示“待研究”，加 `status: researching` 显示“研究中”；文章发布后填写 `article: /posts/文章文件名`，页面会自动显示文章链接和“已有文章”。只有构建中存在的文章才会生成链接，草稿预览单独标识；统计中的文章数按已发布文章去重。不要因为模块有一篇文章就把整个模块视为完成。

OS 首页的专题条目通过 `page: /os/memory` 连接知识地图。文章可添加 `topic_page: /os/memory`，在文末显示返回知识地图的入口。其他专题可复用 `layout: topic-map` 和相同的模块字段。

## 常用修改位置

- 网站名称、首页简介：`hugo.toml`
- 个人介绍：`content/about.md`
- 文章：`content/posts/`
- 样式：`static/css/style.css`
- 首页布局：`layouts/index.html`

自带的 `first-note.md` 是明确标注的示例文章，可以替换或删除。网站未添加邮箱、统计或评论服务。

自动发布配置依据 Hugo 官方指南：https://gohugo.io/host-and-deploy/host-on-github-pages/
