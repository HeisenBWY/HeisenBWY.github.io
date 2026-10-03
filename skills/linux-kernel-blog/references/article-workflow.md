# 文章研究与写作

## 开始前

1. 检查工作树，保留用户已有修改。
2. 确认文章对应的专题模块和研究问题，避免另建重复条目。
3. 记录本地内核的当前分支、短提交号和 Makefile 版本。
4. 从本地源码、随树文档和官方内核文档收集证据。涉及当前上游状态或外部资料时，只使用一手来源，并把链接放在支持相应结论的位置。

## 文章形态

文章需要自然回答以下问题，不要求机械套用固定标题：

- 读者遇到的现象或疑问是什么？
- 最小心智模型是什么？
- 哪些概念容易混淆？
- 本地源码中的关键结构、入口和路径在哪里？
- 哪些行为依赖体系结构、内核配置或运行状态？
- 如何通过只读观察或隔离实验验证？
- 下一篇文章应从哪里继续？

概念关系复杂时，优先给一个小算例、对照表或紧凑文本图。只有图能显著降低理解成本时才使用 Archify。

## Front matter

新文章采用：

```yaml
---
title: "文章标题"
date: 2026-10-02T12:00:00+08:00
description: "一句具体摘要。"
categories: ["OS"]
tags: ["Linux", "内存管理", "内核源码", "openEuler"]
cover: /img/covers/<article-slug>.jpg
---
```

- 日期使用实际写作日期和 `Asia/Shanghai` 时区。标签按内容删减或替换，不要为了形式堆满。
- `title` 用问题式问句，与知识地图中的问题条目对应。
- `cover` 指向 `source/img/covers/` 下的图；未准备封面时省略（回落到主题 `default_cover`）。

## 证据表达

- 文章开头用 `{% note info no-icon %}` 提示块记录源码基线、研究范围和是否包含实测；示例见 `source/_posts/` 既有文章的"研究基线"块。
- 源码路径相对于 `/home/wangyi/openEuler_kernel/` 表达。
- 函数名和结构名使用行内代码；只摘录能直接支持解释的短代码。
- "典型路径"不能写成所有配置都固定执行的调用链。
- 运行系统与源码树可能不一致。给观察命令时提醒读者先记录 `uname -r`、体系结构、页大小和相关配置。
- 命令默认安全、只读。制造内存压力、触发 OOM 或加载修改后内核的实验放入 QEMU 等隔离环境。

## AnZhiYu 标签语法

Hugo 时代的 `callout` shortcode 已全部替换为 AnZhiYu note 标签，写文章时直接使用：

```markdown
{% note info no-icon %} **研究基线** …… {% endnote %}
{% note warning no-icon %} **常见误解** …… {% endnote %}
{% note tip no-icon %} **实验建议** …… {% endnote %}
```

`type` 可用 `info`、`tip`、`warning`、`danger`。不要只为了增加颜色而添加提示框；一个段落只有在需要读者停下来区分概念、条件或风险时才提升为 note。

## 接入知识地图

在 `source/os/memory/index.md` 找到对应问题，把条目从纯文本改为链接：

```markdown
- [问题标题](/posts/<article-slug>/)
```

 permalink 规则为 `posts/:title/`（见 `_config.yml`），内链注意结尾斜杠。如果研究已经开始但尚未成文，保持纯文本条目。不要因一个问题已有文章就声称整个模块完成。

## 验证

至少检查：

```bash
npx hexo clean && npx hexo server -p 4000
git diff --check
```

再用真实浏览器访问 http://localhost:4000/ 确认：文章渲染正常（note 提示块、代码块高亮与行号、封面图）、知识地图链接可达。除非用户已授权，否则不要提交、推送或发布。
