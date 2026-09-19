---
title: "page 与 folio 分别描述什么，为什么需要两种抽象？"
date: 2026-09-19T12:00:00+08:00
draft: false
description: "从基本页、复合页的头页与尾页出发，理解 folio 的接口语义、与 struct page 的内存布局关系，以及两种抽象为什么需要共存。"
categories: ["OS"]
topic_page: /os/memory
series: memory-foundations
series_title: 内存管理基础
series_order: 2
previous_post: /posts/linux-memory-management-overview
next_post: /posts/linux-virtual-resident-physical-memory
tags: ["Linux", "内存管理", "内核源码", "openEuler"]
---

阅读 Linux 内存管理源码时，常会遇到两类指针：`struct page *` 和 `struct folio *`。有些函数接收 page，有些接收 folio，还有一些函数在两者之间转换。

**page 提供基本物理页的描述；folio 则明确表达“把一个或多个页作为整体处理”。** 两者描述的可以是同一块内存，只是接口关注的粒度不同。

要理解为什么需要 folio，关键在于：过去一个 `struct page *` 参数，既可能表示一个基本页，也可能代表整个复合页。仅凭指针类型，无法区分这两种含义。

{{< source-baseline >}}
源码基线：openEuler 内核 `OLK-6.6` 分支，提交 `458474c39f01`，Makefile 版本为 `6.6.0`。该分支包含发行版扩展与回合补丁，结构字段和实现细节以此提交为准。本文是概念与源码阅读笔记，没有运行内核实验；涉及容量的例子假设基本页大小为 4 KiB。
{{< /source-baseline >}}

## 1. 先区分物理页与 struct page

物理页是存放数据的一块内存。基本页大小用 `PAGE_SIZE` 表示，常见配置为 4 KiB，其他体系结构或配置也可能不同。

`struct page` 是内核用来管理页的**元数据结构**，不包含整页的用户数据。对于常规受管理的 RAM，可以先理解为：每个基本物理页都有相应的 `struct page` 描述符。

```text
物理内存中的数据                  管理这些数据的元数据
┌─────────────────────┐          ┌──────────────────┐
│ 一个基本物理页        │  ←描述— │ struct page      │
│ 例如 4 KiB 的数据     │          │ 状态、引用等信息  │
└─────────────────────┘          └──────────────────┘
```

因此，`sizeof(struct page)` 与 `PAGE_SIZE` 是不同的量。前者是描述符的大小，受内核配置影响；后者是一个基本页所容纳的字节数。

在 `include/linux/mm_types.h` 中，`struct page` 包含 `flags`，以及多个联合体。页可以用于文件缓存、匿名内存、内核对象等不同场景，同一片元数据空间会随用途复用。不能把结构里看到的所有字段都当成同时有效，也不能对任意 page 都按文件缓存页解释其 `mapping` 等字段。

## 2. 复合页让 page 指针有了两种粒度

Linux 可以把多个连续基本页组织为一个 **compound page，复合页**。

复合页由一个头页（head page）和后续的尾页（tail pages）组成。组成它的基本页仍有对应的 page 描述符，但其中一些状态和管理操作以整个复合页为单位。

例如，一个 order 为 2 的复合页包含 `2^2 = 4` 个基本页。假设 `PAGE_SIZE` 为 4 KiB，它描述的总容量就是 16 KiB：

```text
物理数据：    [ 4 KiB ][ 4 KiB ][ 4 KiB ][ 4 KiB ]
                 0        1        2        3
page 描述符： [ head  ][ tail  ][ tail  ][ tail  ]
              └──────── 同一个复合页 ──────────┘
```

这里必须区分两个问题：

- “访问第 2 个基本页”关注复合页内部的一个组成部分。
- “引用、锁定或管理这个整体”关注整个复合页。

过去这两种操作都可能使用 `struct page *`。它既可能指向独立的基本页，也可能指向复合页的头页或尾页。一个函数收到 page 指针后，往往需要确认调用者传入的是哪一种，以及是否需要先取得头页。

**物理连续也不等于已经组成复合页。** 高阶页分配是否建立复合页元数据，取决于相应分配路径和标志；几页恰好相邻，更不能自动视为同一个复合页。

## 3. folio 把“整体”的含义放进类型

`struct folio` 表达的是一个作为整体管理的内存单元：可以只有一个基本页，也可以由多个连续基本页组成。

对于这里讨论的正常 folio 对象：

| 情况 | 基本页数量 | folio 指向的元数据位置 |
| --- | --- | --- |
| order 0 folio | 1 | 这个独立页的描述符位置 |
| large folio | `2^order`，且 order 大于 0 | 复合页的头部位置 |

folio 指针不会用尾页的位置来表示整个对象。拿到 `struct folio *` 后，接口可以明确按整体理解参数，而不用先猜它是不是一个尾页。

下图从同一组基本页出发，对比 `page` 的逐页视角和 `folio` 的整体视角，并标出两种接口之间的转换边界。

{{< archify-diagram src="/diagrams/linux-page-and-folio/page-folio.html" title="page 与 folio 的抽象关系图" caption="page 描述基本页位置；folio 从头页位置表达一个整体管理单元。" >}}

图中的关键边界是：任意组成页都可以先归一到所属 folio，但表示整个对象的 folio 指针不会落在尾页上。

引入 folio 的原始补丁说明了这个约定：接收 folio 的函数以整个可能为复合页的对象为操作对象，调用者保证传入的指针不指向尾页。参见 Matthew Wilcox 的 [Introduce struct folio 补丁说明](https://lists.openwall.net/linux-kernel/2021/07/15/99)。

这并不意味着每个 folio 函数都必须处理其中的全部字节。接口仍可以带偏移和长度，只处理一部分数据；明确的是它接收了哪个完整对象，以及对象的边界在哪里。

### 大小不再默认是 PAGE_SIZE

folio 的大小是基本页的二次幂倍数，可以通过辅助函数获取：

| 接口 | 表示什么 | order 2、基本页 4 KiB 的例子 |
| --- | --- | --- |
| `folio_order(folio)` | folio 的阶数 | 2 |
| `folio_nr_pages(folio)` | 包含几个基本页 | 4 |
| `folio_size(folio)` | 描述多少字节的数据 | 16384 |
| `folio_test_large(folio)` | 是否大于一个基本页 | true |

这些接口主要定义在 `include/linux/mm.h` 和 `include/linux/page-flags.h` 中。**`sizeof(struct folio)` 仍然是元数据结构大小，不能用来计算它所描述的数据容量。**

本地 `folio_nr_pages()` 先判断是否为 large folio；如果不是，就直接返回 1。读取大 folio 的页数时才会使用相应扩展字段。这也是为什么阅读结构定义后，应继续阅读访问辅助函数，而不是自行直接读取所有成员。

## 4. folio 并没有再复制一套 page 元数据

看到两个结构名字，容易以为内核先分配若干 page 描述符，再额外分配一个 folio 对象，把它们放进一个列表。

在当前源码实现中，它们通过**兼容的元数据布局**连接起来。`struct folio` 的开头使用联合体覆盖 `struct page`，并通过 `FOLIO_MATCH` 编译期断言检查相关字段的偏移是否一致。较大对象的扩展信息还会使用后续 page 描述符对应的空间。

这意味着，对一个已存在的合法对象进行 page/folio 转换，不会复制物理数据，也不会重新申请一份独立的描述符。

不过，这种布局不等于可以随意访问所有扩展成员。order 0 folio 没有大 folio 所拥有的后续页元数据；辅助函数会根据对象类型和大小选择正确的字段。也不要对 folio 指针直接使用 `folio++` 来寻找下一个对象：C 指针步长依据结构体大小，实际对象覆盖多少基本页则是另一个问题。

阅读依据：`include/linux/mm_types.h` 中的 `struct folio`、`FOLIO_MATCH`，以及 `include/linux/mm.h` 中的 `folio_nr_pages()`。

## 5. page 与 folio 如何转换

### 从任意组成页找到所属 folio

`page_folio(page)` 返回包含这个 page 的 folio。对于尾页，它需要先找到复合页头部；对于独立页，则返回其对应的单页 folio 视图。

本地 `include/linux/page-flags.h` 中，`page_folio()` 通过 `_compound_head()` 完成这一步，并处理 const 类型。

沿用前面的四页例子：

```text
page_folio(head)   ─┐
page_folio(tail 1) ─┤
page_folio(tail 2) ─┼──→ 同一个 folio
page_folio(tail 3) ─┘
```

因此，不能把 `page_folio(page)` 简单改成 `(struct folio *)page`。如果 page 指向尾页，直接强转不会把地址移动到头部，会把尾页元数据错误地解释成 folio。

### 从 folio 找到其中一个基本页

反向操作是 `folio_page(folio, n)`，其中 `n` 是 folio 内部的页编号，从 0 开始。

下面只是表达关系的示意代码，前提是调用者已经保证对象有效，且在操作期间不会被拆分或释放：

```c
struct page *first = folio_page(folio, 0);
struct page *last = folio_page(folio, folio_nr_pages(folio) - 1);

/* first 和 last 都属于原来的 folio。 */
struct folio *owner = page_folio(last);
```

转换函数不替调用者完成全部生命周期管理。`page_folio()` 不会自动增加引用计数，也不接受 NULL；`folio_page()` 不会替调用者检查页编号是否越界。涉及并发拆分时，还必须遵守调用路径要求的引用、锁定或重新验证规则。相关约定可以直接查源码注释及 [Linux 6.6 内存管理 API 文档](https://www.kernel.org/doc/html/v6.6/core-api/mm-api.html)。

## 6. 为什么引入 folio，而不是继续使用 page

### 让接口表达对象粒度

如果一个函数声明接收 `struct page *`，读者通常还需要看实现或注释，才能知道它是否接受尾页、处理一个基本页还是整个复合页。

使用 `struct folio *` 后，接口先明确“这是完整对象”。把两种含义分成不同的结构指针，也让编译器有机会发现类型不匹配，减少对人工约定的依赖。它不能阻止所有错误强转，但可以让正常接口调用更清楚。

### 减少重复的头页归一化

在使用 page 的调用链中，多个函数可能分别调用 `compound_head()`，因为每一层都不知道上游是否已经找过头页。

如果先转换为 folio，再沿 folio 接口传递，后续函数便可以依赖整体对象的约定。这有助于减少冗余检查，也使代码更容易审查。实际性能收益仍取决于具体路径，不能只根据函数名变化就断言某项负载变快。

最初的 [folio RFC](https://lists.openwall.net/linux-kernel/2020/12/08/1156) 就指出了这两个问题：难以追踪是否已经调用过 `compound_head()`，以及 page 参数到底代表基本页还是整个复合页的大小。

### 为更大粒度的管理提供统一接口

Page Cache 等路径既可能处理单页对象，也可能处理大于一个基本页的对象。使用 folio 后，可以根据实际大小处理数据，避免在接口中把所有对象都假设成 `PAGE_SIZE`。

例如，本地 `mm/filemap.c` 的缓冲读路径会获取 `folio_size(folio)`，计算本次读取在 folio 内的偏移和长度，再调用 `copy_folio_to_iter()`。同一套逻辑可以表达不同大小的缓存对象。

更大的管理粒度有机会分摊部分查找、锁定和管理开销，但也可能增加分配难度、内存占用或拆分成本。是否适合使用大 folio，需要结合负载与实现分析。

## 7. 为什么 page 仍然存在

明确整体对象，并没有消除“其中某一个基本页”的需求。

页帧编号（PFN）与描述符的转换、部分页表和映射操作、处理复合页内部某一页的路径，以及尚未转换的接口，仍然需要 page。不同用途的元数据也在逐步采用各自的类型，不能把 folio 当成所有 page 用途的通用替代物。

可以把这两类问题分别记住：

- **page：我现在处理的是哪个基本页，或者传统接口用哪个 page 指针代表对象？**
- **folio：这个作为整体管理的对象包含多少页，它的状态和生命周期如何处理？**

因此，page 与 folio 的共存既涉及接口演进，也反映了不同粒度的实际需要。源码阅读时应按函数契约理解，而不是机械地把所有 `page_*` 函数替换成 `folio_*`。

## 8. 几个容易混淆的地方

| 常见理解 | 更准确的解释 |
| --- | --- |
| folio 就是大页 | order 0 folio 只有一个基本页；只有 large folio 才大于基本页 |
| 一个 folio 必须用一个大页页表项映射 | folio 的管理粒度与页表映射粒度不同，大 folio 也可能通过多个 PTE 映射 |
| folio 可以把分散物理页拼起来 | 单个 folio 描述的物理内存连续；这不是 vmalloc 那样的虚拟映射拼接 |
| 几个连续 page 就是一个 folio | 连续性还不够，必须满足对应对象的组织与元数据约定 |
| folio 只用于文件缓存 | 本地匿名缺页路径也使用 folio，例如 `mm/memory.c` 中的 `do_anonymous_page()` |
| folio 越大就一定越快 | 收益需要与分配、回收、拆分和实际访问模式一起评估 |

尤其需要区分 **folio、THP 与 HugeTLB**：folio 是对象抽象；THP 和 HugeTLB 涉及具体的大页机制。它们有联系，但不是可以互换的名字。

## 9. 沿五个入口读一遍源码

这篇内容不要求先编译内核。可以从以下几个位置建立最小阅读闭环：

| 顺序 | 源码位置 | 要确认的问题 |
| --- | --- | --- |
| 1 | `include/linux/mm_types.h`：`struct page`、`struct folio`、`FOLIO_MATCH` | 两种描述符如何通过布局对应？ |
| 2 | `include/linux/page-flags.h`：`_compound_head()`、`page_folio()`、`folio_page()` | 尾页如何回到头部，整体如何定位子页？ |
| 3 | `include/linux/mm.h`：`folio_order()`、`folio_nr_pages()`、`folio_size()` | 对象大小如何计算，单页与大 folio 如何区分？ |
| 4 | `mm/page_alloc.c`：`__folio_alloc()` | folio 分配如何连接到底层页分配？ |
| 5 | `mm/filemap.c`：`folio_size()`、`copy_folio_to_iter()` 的调用处 | 上层代码如何根据实际对象大小处理数据？ |

本地 `__folio_alloc()` 调用 `__alloc_pages()` 时加入 `__GFP_COMP`，然后通过 `page_rmappable_folio()` 返回结果。这给前面的概念补上了实际连接：folio 仍然建立在页分配基础上，高阶对象需要相应的复合页组织。

读完后，可以用三个问题检查理解：一个尾页指针为什么不能直接强转为 folio？为什么单页对象也可以用 folio 接口？为什么 `folio_size()` 不能用 `sizeof(struct folio)` 替代？能够解释这三个问题，就可以继续阅读匿名缺页与 Page Cache 中更具体的使用路径。

## 参考资料

- [前一篇：Linux 内存管理全景入门](/posts/linux-memory-management-overview/)。
- [Matthew Wilcox：Introduce struct folio，2021 年补丁说明](https://lists.openwall.net/linux-kernel/2021/07/15/99)。
- [Matthew Wilcox：Introduce struct folio，2020 年 RFC](https://lists.openwall.net/linux-kernel/2020/12/08/1156)。
- [Linux 6.6 Memory Management APIs](https://www.kernel.org/doc/html/v6.6/core-api/mm-api.html)。
- 本文源码路径均相对于 openEuler 内核仓库根目录，基线为 `458474c39f01`。公开文档用于理解接口，具体字段和调用实现以本地基线为准。
