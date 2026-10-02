---
title: "malloc、brk 与 mmap 是什么关系？"
date: 2026-10-02T12:00:00+08:00
description: "malloc 是 libc 的用户态分配器，brk 与 mmap 是它向内核要地址空间的两条系统调用路径。从 ptmalloc 的阈值、动态调整与两条归还路径出发，理解堆的增长与收缩边界。"
categories: ["OS"]
tags: ["Linux", "内存管理", "glibc", "内核源码", "openEuler"]
cover: /img/covers/linux-malloc-brk-mmap.jpg
---

用 `strace` 跟踪一个不断 `malloc` 的程序：分配几十字节时，常常看不到任何系统调用；分配稍大一点，出现一次 `brk`；分配到几十 MiB，出现的却是 `mmap`。三个名字是什么关系？

**malloc 是 libc 里的用户态分配器，brk 和 mmap 是它向内核申请地址空间的两种系统调用。** 用户代码面对的是 malloc 的 chunk 和空闲链表，内核面对的是 VMA；两层各自记账，中间通过这两个入口衔接。

{% note info no-icon %}
**研究基线**

源码基线：内核为 openEuler `OLK-6.6` 分支（提交 `458474c39f01`，对应 6.6.0）；glibc 部分对照上游 `malloc/malloc.c` 与 `malloc/arena.c`。文中默认值为 64 位平台口径：`M_MMAP_THRESHOLD` 初始 128 KiB，动态上限 32 MiB，非主 arena 保留区 64 MiB。本文概念与源码阅读为主，实验节给出可复现步骤。
{% endnote %}

## 1. 先把三个名字放回正确的层

| 名字 | 所在层 | 回答的问题 |
| --- | --- | --- |
| `malloc` / `free` / `calloc` / `realloc` | libc 用户态 | 把大块内存切成小 chunk 复用，尽量少陷入内核 |
| `brk(2)`（`sbrk` 是它的 libc 增量封装） | 系统调用 | 移动 program break，伸缩 `[heap]` 这一段 |
| `mmap(2)` / `munmap(2)` | 系统调用 | 建立或撤除一个独立映射区间，可匿名可文件 |

一个常见误解是“malloc 是系统调用”或“malloc 直接找内核要内存”。实际上，多数 `malloc` 调用只发生在用户态：分配器从自己缓存的大块里切出一段，用指针操作完成。只有当缓存的内存不够、或单次请求超过阈值时，才通过 `brk` 或 `mmap` 向内核要新地址空间。

这也解释了开头观察到的三种现象：小分配命中缓存，零系统调用；缓存不够时扩堆，一次 `brk`；大分配绕过缓存，一次 `mmap`。

## 2. brk：只移动堆顶这一条线

program break 是进程数据段之后的一个边界地址，也就是堆的顶端。`brk(addr)` 把这个边界移动到 `addr`：升高则堆增长，降低则堆收缩。

```text
低地址                                        高地址
┌──────────┬────────┬─────────────┬──────────┐
│ 代码/只读 │  data   │    [heap]    │ （未映射） │
│   数据    │  bss    │  break 之下   │ break 之上 │
└──────────┴────────┴─────────────┴──────────┘
                              ↑
                       brk 只移动这一个顶端
```

在内核 6.6 的 `mm/mmap.c` 中，`SYSCALL_DEFINE1(brk)` 处理这个入口；增长路径调用 `do_brk_flags()`，检查权限和地址空间后，扩展（或新建）堆对应的匿名 VMA，并尝试与相邻区间合并。收缩路径则走解除映射的逻辑，把顶部地址区间连同页表项一起撤掉。

```bash
cat /proc/<pid>/maps | grep heap
```

输出里的 `[heap]` 行就是这段 VMA：它只有一个，覆盖整个堆，`break` 就是它的 `end`。

`brk` 的特点决定了它的适用面：

- **地址必须连续**。只能从当前堆顶往上长，不能在任意空闲位置插入。
- **只能从顶端伸缩**。中间的内存释放了，堆顶不动，堆就不缩。
- **元数据开销小**。整个堆通常就是一个 VMA，内核不需要为每次小分配登记新区间。

## 3. mmap：按需建立独立映射

`mmap` 的能力大得多：可以在地址空间里任意可用位置建立一段新映射，长度按页对齐，可以映射文件，也可以建立匿名的私有内存。malloc 用的是后一种：

```text
mmap(NULL, len, PROT_READ | PROT_WRITE,
     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)
```

对分配器来说，这条路的性质与 `brk` 相反：

- 每个 mmap 分配是一个**独立 VMA**，与其他分配互不相连。
- `free` 时可以直接 `munmap`，把整段地址空间**立刻归还**内核，物理页也随之释放。
- 但每次都要陷入内核，映射按页对齐，小对象用这条路浪费大。

所以 `brk` 适合“大量小块、长期复用”的堆形态，`mmap` 适合“一次性大块、用完即还”的形态。ptmalloc 的策略就是把这两条路按大小分流。

## 4. malloc 的分配路径与阈值

glibc 的 ptmalloc 把从 `brk` 堆里切出来的内存组织成 chunk；相邻空闲 chunk 可以合并，空闲块按大小放进不同 bin 复用。请求到来时的决策顺序是：

```text
malloc(n)
 ├─ 在现有 bin / top chunk 中找到可用块？
 │    └─ 是：直接切分返回（纯用户态，无系统调用）
 ├─ n ≥ mmap_threshold 且 mmap 计数未超上限？
 │    └─ 是：走 mmap 路径，独立 VMA，记录为 mmap chunk
 └─ 否则：sbrk 扩堆，新内存并入 top chunk 再切分
```

关键参数是 `mmap_threshold`，即 `mallopt` 的 `M_MMAP_THRESHOLD`：

| 参数 | 默认值（64 位） | 含义 |
| --- | --- | --- |
| `M_MMAP_THRESHOLD` | 128 KiB | 请求不小于该值时优先 mmap |
| `M_TRIM_THRESHOLD` | 128 KiB | top chunk 超出部分超过该值才收缩堆 |
| `M_TOP_PAD` | 0 | 每次向内核申请时额外多要的字节数 |
| `M_MMAP_MAX` | 65536 | mmap 分配的最大次数限制 |

动态调整是这套策略里容易被忽略的部分。释放一个 mmap chunk 时，若它大于当前阈值，分配器会做两件事（见 `malloc.c` 中 `free` 路径对 `no_dyn_threshold` 的检查）：

```text
mmap_threshold = 这个 chunk 的大小
trim_threshold = 2 × mmap_threshold
```

阈值随使用模式上涨，上限 `DEFAULT_MMAP_THRESHOLD_MAX` 在 64 位平台是 32 MiB（`4 MiB × sizeof(long)`）。也就是说：程序反复分配并释放几十 MiB 的块，第一块走 mmap，之后的块会留在堆里复用；这既是优化，也可能让 `free` 之后内存不降——后面会回到这一点。

## 5. free 的两条归还路径

`free` 的去向取决于 chunk 的来源：

| chunk 来源 | free 时发生什么 | 物理页/地址空间 |
| --- | --- | --- |
| 堆内普通 chunk | 标记空闲、与相邻空闲块合并、可能并入 top | 通常什么都不还，留待复用 |
| mmap chunk | 立即 `munmap` 整段 | 地址区间和已驻留页马上归还 |

对堆内 chunk，只有一种情况可能触发“还给内核”：它紧邻 top chunk 并与之合并后，top 的空闲部分超过 `trim_threshold`，分配器调用 `sbrk` 负值把堆顶降下来。`malloc_trim(0)` 可以强制执行一次这种收缩，绕过阈值判断。

## 6. 为什么堆经常不收缩

把上面的规则合起来，就能解释“free 之后 `top`/RSS 不降”的常见困惑：

```text
低地址                                          高地址
┌─────────────┬───────────┬─────────┬───────────┐
│  已分配 chunk │  空闲空洞   │ 已分配    │ top chunk  │
└─────────────┴───────────┴─────────┴───────────┘
                ↑ 中间有已分配块挡着，堆顶不能越过它们收缩
```

- 堆**只能从顶端收缩**，中间的空闲块无法归还（外部碎片）。
- 即使顶端连成了大片空闲，也要**超过 trim 阈值**才真正调用 `sbrk` 收缩。
- 动态阈值上涨后，原本会 munmap 的大块被留在堆里，`free` 不再触发 `munmap`。
- 收缩只撤掉顶部区间的页表和 VMA；底层物理页归还依赖这条解除映射路径完成。

这不是泄漏：同样的地址空间会被后续分配复用。判断是否真泄漏，更可靠的是观察分配来源与增长是否无界，而不是单次 `free` 后内存数字是否下降。

## 7. 多线程：arena 把两条路都用上

单线程程序只有一个主 arena，建立在 `brk` 堆上。多线程下 glibc 会为线程创建额外的 arena：用 `mmap` 保留一大段地址空间（`HEAP_MAX_SIZE`，64 位平台为 64 MiB 且按此对齐），在其中像小堆一样用 bump 指针生长。线程优先使用绑定到的 arena，竞争激烈时可以创建新的，数量上限默认是核数的 8 倍（可用环境变量 `MALLOC_ARENA_MAX` 调整）。

这解释了多线程进程 `maps` 里的一个典型景象：一个 `[heap]`，加上若干 64 MiB 对齐的大匿名区间。它们都是 malloc 的堆，只是主 arena 来自 `brk`，其余来自 `mmap`。

## 8. 内核视角：两条路径最后都变成 VMA 操作

从内核看，两个入口的差异比想象中小：

| | `brk` 增长 | `mmap`（匿名私有） |
| --- | --- | --- |
| 实现位置 | `mm/mmap.c` 的 `do_brk_flags()` | `mm/mmap.c` 的 `mmap_region()` |
| 结果 | 扩展现有堆 VMA（或新建） | 建立新 VMA |
| 物理内存 | 不分配 | 不分配 |
| 实际拿页 | 之后访问触发缺页，按需分配 | 同左 |

也就是说，**两条路径都只登记了“这段地址将来可以这样用”的规则，真正分配物理页要等到缺页**——这正是上一篇 VMA 与页表分层的直接应用。区别只在登记方式：一个是在既有 VMA 上改 `end`，一个是从 maple tree 里新插入一个节点。

## 9. 实验：亲眼看一次两条路径

用一个小程序把两条路径都触发出来：

```c
#include <stdio.h>
#include <stdlib.h>

int main(void)
{
    char *small = malloc(4 * 1024);       /* 小块：走堆 */
    char *big = malloc(64 * 1024 * 1024); /* 64 MiB：走 mmap */

    memset(small, 1, 4 * 1024);
    memset(big, 1, 64 * 1024 * 1024);
    printf("pid=%d small=%p big=%p\n", getpid(), small, big);
    getchar();                            /* 停在这里观察 */

    free(small);
    free(big);
    getchar();
    return 0;
}
```

编译后跟踪系统调用：

```bash
gcc -o demo demo.c
strace -e trace=brk,mmap,munmap ./demo
```

可以对照验证三件事：

- 启动阶段就有若干 `mmap`（加载动态库等），其中一次 `brk` 是扩堆。
- 4 KiB 的小分配不产生新的系统调用；64 MiB 的分配产生一次 `mmap`，地址不在 `[heap]` 范围内。
- `free(big)` 对应一次 `munmap`；`free(small)` 没有对应调用。

停在 `getchar()` 时另开终端查看映射：

```bash
cat /proc/<pid>/maps | grep -E 'heap|64M|\[stack\]'
```

能看到 `[heap]` 只有很小的增长，而 64 MiB 是一段独立的匿名区间。释放前后对比 `VmRSS`，只有大块会立刻下降。

{% note tip no-icon %}
**实验建议**

把分配大小改成 1 MiB 反复试：第一次会走 `mmap`，但动态阈值随后涨到 1 MiB 以上，紧接着同样的分配就改走堆了。想固定行为，可以用 `mallopt(M_MMAP_THRESHOLD, ...)` 关闭动态调整，或设 `MALLOC_MMAP_THRESHOLD_` 环境变量。观察 arena 时，把程序改成多线程并 sleep，再看 `maps` 里的 64 MiB 对齐区间。
{% endnote %}

## 10. 常见误区

- **“malloc 是系统调用”**：不是。它是 libc 函数，多数时候完全不陷入内核。
- **“free 一定把内存还给内核”**：堆内 chunk 通常不还；只有顶端超阈值收缩或 mmap 块 munmap 才真正归还。
- **“brk 分配的内存 mmap 也能看到”**：`[heap]` 由 brk 语义独占，mmap 匿名区间是独立 VMA，两者在 `maps` 中是不同的行。
- **“calloc 就是 malloc 加 memset”**：对 mmap 来的块，页本来就是零，calloc 可以跳过清零；小堆块仍需按需处理。语义上等价，成本不同。
- **“阈值是固定 128 KiB”**：只是初始值，会动态上涨到 32 MiB（64 位）。

## 参考与源码索引

- [glibc malloc/malloc.c](https://github.com/bminor/glibc/blob/master/malloc/malloc.c)：`DEFAULT_*` 参数、动态阈值、`free` 的收缩路径。
- [glibc malloc/arena.c](https://github.com/bminor/glibc/blob/master/malloc/arena.c)：`HEAP_MAX_SIZE`、多线程 arena 的建立。
- [GNU C Library 手册：Memory Allocation](https://www.gnu.org/software/libc/manual/html_node/Memory-Allocation-and-C.html)：分配器行为总览。
- [brk(2)](https://man7.org/linux/man-pages/man2/brk.2.html)、[mmap(2)](https://man7.org/linux/man-pages/man2/mmap.2.html)、[malloc(3)](https://man7.org/linux/man-pages/man3/malloc.3.html)、[mallopt(3)](https://man7.org/linux/man-pages/man3/mallopt.3.html) 手册页。
- 内核 `mm/mmap.c`（openEuler OLK-6.6）：`SYSCALL_DEFINE1(brk)`、`do_brk_flags()`、`mmap_region()`。
- 本系列前篇：《mm_struct 和 VMA 如何描述一个进程的地址空间？》给出 VMA 与页表的两层模型，本文的“登记区间、缺页拿页”正建立在其上。
