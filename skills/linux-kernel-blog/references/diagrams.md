# 内核文章图表规范

## 何时使用

当文章包含三项以上组件关系、跨层调用流程、状态转换或难以用线性文字表达的数据流时，使用 Archify。单个定义、两项对比或一个公式不需要图。

适合的内存主题包括：

- 虚拟地址、VMA、页表和物理页的层级关系。
- page、head/tail page、folio 的包含关系。
- 匿名映射从访问、缺页到建立 PTE 的流程。
- Buddy 拆分与合并、回收与规整、Page Cache 读写路径。

## 制作流程

1. 先从文章和源码证据确定图要解释的一个核心问题。
2. 根据关系选择 Archify 类型：组件关系用 `architecture`，执行路径用 `workflow`，调用往返用 `sequence`，数据流用 `dataflow`，状态变化用 `lifecycle`。
3. 使用 `archify` skill，并遵守其 schema、验证、deliver 和 visual-check 要求。默认静态，不为普通文章开启动画。
4. 控制主节点数量和标签长度。图中保留结构与方向，细节留在正文。

## 仓库位置

- 独立交互 HTML：`source/diagrams/<article-slug>/`（由 `_config.yml` 的 `skip_render: diagrams/**` 原样输出，不经过主题渲染）。
- 文章封面等静态图片：`source/img/covers/`。

archify 导出的单个 HTML 约 700KB（其中 SVG 仅约 12KB，其余为框架脚本），目前接受该体积；如需精简另行讨论，不在每篇文章上重复优化。

## 嵌入与链接

文章内通过 iframe 嵌入（带 `?embed=1&theme=light` 参数，隐藏 archify 自带头部工具栏），并提供"打开完整交互图 ↗"链接到独立页面。完整页面因为 `skip_render` 不包含博客导航，是纯图应用。容器样式由 `source/css/custom.css` 的 `.kernel-diagram*` 规则提供。

## 与正文的关系

- 图前说明读者应观察什么，图后解释结论。
- 图中的名称与源码结构、函数和文章术语一致。
- 图不能把可能路径画成必经路径，不能省略会改变结论的重要条件。
- 图表是派生产物；文章 Markdown 是文字的可维护来源。
