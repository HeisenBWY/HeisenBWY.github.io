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

- 可维护的 Archify JSON：`diagram-sources/<article-slug>/`
- 独立交互 HTML：`static/diagrams/<article-slug>/`
- 文章直接展示的 SVG/WebP：`static/images/diagrams/<article-slug>/`

默认在文章中嵌入经过检查的静态 SVG，并提供准确的替代文字和一句图注。只有搜索、聚焦、主题切换或关系追踪确实帮助读者时，才额外提供交互 HTML 链接；不要默认用 iframe 增加阅读负担。

## 与正文的关系

- 图前说明读者应观察什么，图后解释结论。
- 图中的名称与源码结构、函数和文章术语一致。
- 图不能把可能路径画成必经路径，不能省略会改变结论的重要条件。
- 图表是派生产物；文章 Markdown 与 Archify JSON 分别是文字和图的可维护来源。
