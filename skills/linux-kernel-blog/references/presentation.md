# Hexo + AnZhiYu 阅读与视觉规范

## 站点形态

博客由 Hexo 静态生成，使用 [anzhiyu-c/hexo-theme-anzhiyu](https://github.com/anzhiyu-c/hexo-theme-anzhiyu) 主题（npm 依赖 `hexo-theme-anzhiyu`）。视觉基准对齐 subingwen.cn：大图首屏、文章卡片流、左封面右摘要。

配置分为三层，改动前先确定属于哪层：

| 层 | 文件 | 负责什么 |
| --- | --- | --- |
| 站点级 | `_config.yml` | permalink、`skip_render`（diagrams/ 原样输出）、highlight.js 输出格式 |
| 主题级 | `_config.anzhiyu.yml` | 导航菜单、封面开关、代码块工具栏、社交图标、页脚 |
| 定制层 | `source/css/custom.css` | 行内代码红字、代码块 token 着色、架构图 iframe 容器 |

**禁止**直接修改 `node_modules/hexo-theme-anzhiyu/` 内的文件（`npm ci` 会覆盖）；需要主题级定制时优先用配置项，其次在 custom.css 里加覆盖规则。

## 代码块（参考 subingwen.cn，勿回退）

- `_config.yml` 的 highlight 设置：`line_number: true`、`hljs: false`。**`hljs: false` 是关键**——开启会让 token class 带 `hljs-` 前缀，主题 CSS 无法命中，代码块变成单色。
- `_config.anzhiyu.yml` 使用 `highlight_theme: mac light`，呈现三色圆点、语言标题、独立行号栏和浅色代码区；工具栏设置为 `highlight_copy: true`（复制按钮）、`highlight_lang: true`（语言标签）、`highlight_shrink: false`（默认展开带折叠按钮）。
- `highlight_height_limit: 900`，普通示例尽量完整显示，只对很长的代码块提供展开控件。
- custom.css 补充规则：新版 highlight.js 的 `.type`、`.title.function_` 着色为 `#6182b8`，对齐旧版解析器的蓝色函数签名。
- 代码语言标注：bash 命令用 ` ```bash `，C 代码用 ` ```c `，纯示意/文本图用 ` ```text `。

## 行内代码（custom.css 维护）

行内代码样式为无底色、红色加粗（#ff7c7c）的轻量标记，不添加外边距、阴影或额外行高。规则限定在 `#article-container code`，并用 `#article-container pre code` 恢复代码块内部样式，避免互相污染。暗色模式下代码块背景为 #171717。

## 文章封面

- 每篇文章 front-matter 指定 `cover: /img/covers/<article-slug>.jpg`，图片放 `source/img/covers/`。
- 封面图用文生图 API（`https://console.enterprise.trae.cn/api/ide/v1/text_to_image?prompt=...&image_size=landscape_16_9`）按文章主题生成抽象技术插画；prompt 遵循 SDXL 风格：具体、克制配色、wide banner、no text。
- 未指定 `cover` 的文章回落到 `_config.anzhiyu.yml` 的 `default_cover`（/img/cover.jpg）。

## 文章内架构图

archify 导出的交互 HTML 放 `source/diagrams/<article-slug>/`，`_config.yml` 的 `skip_render: diagrams/**` 保证它们原样输出、不套主题模板（否则会"博客嵌博客"）。

文章内嵌入方式：

```html
<figure class="kernel-diagram">
  <div class="kernel-diagram-frame">
    <iframe src="/diagrams/<slug>/<file>.html?embed=1&amp;theme=light" title="图标题" loading="lazy"></iframe>
  </div>
  <figcaption>图注。 <a href="/diagrams/<slug>/<file>.html" target="_blank" rel="noopener">打开完整交互图 ↗</a></figcaption>
</figure>
```

容器样式（宽高比、圆角、暗色适配）由 custom.css 的 `.kernel-diagram*` 规则维护。iframe 必须带 `?embed=1` 让 archify 隐藏自身工具栏。

## 本地验证

- 预览：`npx hexo server -p 4000`，配置或渲染异常时先 `npx hexo clean`。
- 用真实浏览器检查：首页卡片封面、文章代码块（行号、高亮、复制按钮）、note 提示框、暗色模式、架构图 iframe。
- 线上部署由 `.github/workflows/hexo.yml` 自动完成，不在本地提交 `public/`。
