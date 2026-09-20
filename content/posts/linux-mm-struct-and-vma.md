---
title: "mm_struct 和 VMA 如何描述一个进程的地址空间？"
date: 2026-09-21T00:30:00+08:00
draft: true
description: "从 task_struct、mm_struct、Maple Tree 与 vm_area_struct 出发，理解 Linux 如何组织进程地址空间，以及 VMA 与页表、物理页之间的边界。"
categories: ["OS"]
topic_page: /os/memory
series: process-address-space
series_title: 进程地址空间
series_order: 1
cover_theme: address-space
cover_symbol: VMA
tags: ["Linux", "内存管理", "VMA", "虚拟内存", "内核源码", "openEuler"]
---

打开 `/proc/<pid>/maps`，可以看到代码、共享库、堆、栈和匿名映射分布在不同的虚拟地址区间。内核如何保存这些区间？一个虚拟地址到来时，又怎样判断它是否有效、能不能写、应该从文件读取还是分配匿名页？

**`mm_struct` 描述一个用户地址空间的全局上下文，`vm_area_struct` 描述其中一段具有相同映射规则的连续区间。** 当前内核用 `mm_struct.mm_mt` 这棵 Maple Tree 按地址组织 VMA；页表则是另一层结构，记录虚拟页当前如何翻译。把这两层分开，是理解进程内存管理的起点。

{{< source-baseline >}}
源码基线：openEuler 内核 `OLK-6.6` 分支，提交 `458474c39f01`，Makefile 版本为 `6.6.0`。本文分析开启 MMU 的普通用户进程；部分字段受体系结构和内核配置影响。文中的地址布局仅为概念示意，不代表某次真实运行结果。
{{< /source-baseline >}}

## 1. 先建立最小模型

对普通用户进程，可以先记住下面四层：

1. `task_struct` 代表一个任务，成员 `mm` 指向它使用的用户地址空间。
2. `mm_struct` 保存该地址空间的全局信息，包括 VMA 索引、页表根、地址布局、统计和同步对象。
3. 每个 `vm_area_struct`，简称 VMA，描述一个半开区间 `[vm_start, vm_end)` 以及这段区间的访问和后备规则。
4. 页表保存更细粒度的地址翻译状态；访问尚未建立页表项的合法地址时，缺页处理会依据 VMA 决定下一步动作。

{{< archify-diagram src="/diagrams/linux-mm-struct-and-vma/address-space.html" title="mm_struct、VMA 与页表的关系" caption="VMA 描述区间规则，页表描述页级翻译；mm_struct 把两条路径组织在同一个地址空间上下文中。" >}}

这张图最重要的不是箭头数量，而是上下两条路径的区别：

- `mm_mt → VMA` 回答“这个地址属于什么区域，允许怎样访问”。
- `pgd → 页表项` 回答“这个虚拟页此刻映射到哪里，或者当前是否还没有有效映射”。

因此，**VMA 存在不等于已经分配物理页，也不等于相应 PTE 已经建立。** 一个 1 GiB 的匿名 VMA 可以只访问少量页面；未访问部分仍属于合法地址区间，却通常不会因此立刻占用 1 GiB 的独立物理页。

## 2. mm_struct 是地址空间的总目录

`include/linux/mm_types.h` 中的 `struct mm_struct` 很大，第一次阅读不适合逐字段背诵。可以按职责把关键成员分成几组：

| 职责 | 代表成员 | 回答的问题 |
| --- | --- | --- |
| VMA 组织 | `mm_mt`、`map_count` | 有哪些 VMA，如何按地址查找，共有多少个？ |
| 页表上下文 | `pgd`、`context`、`page_table_lock` | 页表根在哪里，体系结构相关上下文是什么？ |
| 地址布局 | `mmap_base`、`task_size` | mmap 区域从哪里布局，用户地址上限是什么？ |
| 程序边界 | `start_code`、`end_code`、`start_brk`、`brk`、`start_stack`、参数和环境区间 | 可执行文件装载后，关键区域位于哪里？ |
| 统计 | `total_vm`、`data_vm`、`exec_vm`、`stack_vm`、RSS 计数 | 地址空间各类映射规模如何记账？ |
| 并发与生命期 | `mmap_lock`、`mm_users`、`mm_count` | 谁可以修改布局，这个对象何时仍然有效？ |

这些字段不是彼此孤立的。例如，建立一个新的匿名映射时，内核可能插入或扩展 VMA，同时更新 `map_count` 和 `total_vm`；真正访问页面后，RSS 等驻留统计才可能变化。

`mm_struct` 也不是“一个进程全部内存的容器”。它保存的是管理上下文和元数据，不把用户数据字节直接塞进结构体。用户数据位于物理页、文件或交换后备中，页表和 VMA 把这些对象与虚拟地址联系起来。

### 两组引用计数不要混成一个

本地结构注释区分了 `mm_users` 与 `mm_count`：

- `mm_users` 面向仍在使用这个用户地址空间的用户；归零后会释放用户地址空间资源，并减少一份 `mm_count` 引用。
- `mm_count` 管理 `mm_struct` 本身的生命期；归零后结构才可释放。

这允许内核代码在用户态地址空间已经退出后，仍短暂持有 `mm_struct` 元数据。实际代码应通过 `mmget()`、`mmput()`、`mmgrab()`、`mmdrop()` 等配对接口管理，不能直接修改计数。

## 3. VMA 是一段地址的共同规则

同一进程可以包含许多 VMA。每个 VMA 覆盖 `[vm_start, vm_end)`：起始地址属于区域，结束地址不属于区域。源码注释把 VMA 概括为“对缺页处理具有特殊规则的一部分进程虚拟空间”。

`struct vm_area_struct` 的关键字段可以这样理解：

| 字段 | 含义 |
| --- | --- |
| `vm_start`、`vm_end` | VMA 的半开地址区间 |
| `vm_mm` | 该 VMA 属于哪个 `mm_struct` |
| `vm_flags` | 可读、可写、可执行、共享、增长方向等语义标志 |
| `vm_page_prot` | 建立页表项时使用的体系结构相关页保护属性 |
| `vm_file`、`vm_pgoff` | 文件映射的后备文件与页偏移；匿名映射通常没有 `vm_file` |
| `anon_vma`、`anon_vma_chain` | 匿名页反向映射相关关系 |
| `vm_ops` | 缺页、打开、关闭等映射特定操作 |
| `vm_policy` | 启用 NUMA 时，该区域可带有自己的内存策略 |

所谓“一段具有相同规则的区域”，不意味着其中每个虚拟页的当前状态相同。有些页可能已驻留，有些尚未访问，有些可能被换出；VMA 提供的是处理这些地址时共同遵守的上层规则。

### 空洞不是一个特殊 VMA

两个 VMA 之间没有被任何 VMA 覆盖的地址范围，通常就是地址空间空洞。访问普通空洞时，内核找不到允许该访问的 VMA，缺页处理不能据此建立正常用户映射，进程通常会收到 `SIGSEGV`。

栈增长等路径需要额外检查，不能简单理解为“空洞都绝对不能变成 VMA”。关键是：空洞本身并不靠一个“无效 VMA”来表示，Maple Tree 中没有对应区间项。

## 4. Maple Tree 如何组织 VMA

在这份 6.6 基线中，`mm_struct.mm_mt` 是一棵 Maple Tree。`Documentation/core-api/maple_tree.rst` 将它描述为适合存储非重叠范围、支持间隙查找并关注缓存效率的 B 树；VMA 是它的重要使用场景。

`kernel/fork.c:mm_init()` 初始化 `mm_mt`，并把 `mmap_lock` 设为它的外部锁。`include/linux/mm_types.h` 中的 `VMA_ITERATOR` 和 `vma_iter_init()` 也都把迭代状态绑定到 `mm->mm_mt`。

概念上，可以把一组 VMA 看成：

```text
低地址                                                        高地址
   VMA A              空洞          VMA B             VMA C
[0x1000, 0x4000)                  [0x8000, 0xa000) [0xa000, 0xc000)
```

真实内核不是靠每次从头扫描这个文本列表来查找，而是用 Maple Tree 按地址定位和遍历区间。

### find_vma 有一个容易踩坑的语义

`mm/mmap.c:find_vma()` 调用 `mt_find()`，返回满足条件的 VMA：

- 如果 `addr` 位于某个 VMA 内，返回这个 VMA。
- 如果 `addr` 位于空洞，可能返回地址更高的下一个 VMA。
- 如果该地址及其上方都没有 VMA，返回 `NULL`。

所以，`find_vma(mm, addr)` 返回非空，**不能单独证明 `addr` 已被映射**。调用者仍需确认：

```c
vma && addr >= vma->vm_start
```

因为 `find_vma()` 已保证 `addr < vma->vm_end`，补上起始边界检查后才说明地址落在该 VMA 中。

如果只想查找确实覆盖给定地址的 VMA，`include/linux/mm.h:vma_lookup()` 直接对 `mm_mt` 使用 `mtree_load()`，找不到时返回 `NULL`。区间查找还有 `find_vma_intersection()`，它按 `[start_addr, end_addr)` 判断是否与 VMA 相交。

## 5. VMA 与页表各自描述什么

把两者混在一起，会产生很多错误推论。可以用一张表明确边界：

| 问题 | 主要由 VMA 回答 | 主要由页表回答 |
| --- | --- | --- |
| 这个地址是否属于某段合法映射 | 是 | 不能只靠页表判断完整语义 |
| 这段区域是否允许写或执行 | 是，`vm_flags` 等提供上层规则 | 页表项实现当前页的硬件权限 |
| 后备对象是匿名内存还是某个文件 | 是 | 否 |
| 当前虚拟页映射到哪个页帧 | 否 | 是 |
| 页面是否尚未建立、已换出或处于特殊状态 | 不记录每页当前状态 | 由页表项及相关状态表达 |

两层会相互配合。发生用户态缺页异常时，内核先确认地址所属的 VMA 及访问类型是否符合规则，然后根据匿名、文件、共享、写时复制等情况处理页级映射。

页表权限也不必在任何时刻都与 VMA 的最大许可完全相同。例如，私有可写映射在 `fork` 后可以暂时以只读页表项实现写时复制；VMA 仍表达区域允许写，首次写入则通过缺页路径获得私有可写页面。VMA 是策略边界，页表项是当前执行状态的一部分。

## 6. VMA 会创建、合并、拆分和删除

VMA 不是用户每调用一次 `mmap()` 就永久对应一个独立对象。

本地 `mm/mmap.c:__mmap_region()` 在建立映射时，会先检查相邻 VMA 是否满足合并条件。权限、文件、偏移、匿名映射关系、策略等条件兼容时，新区间可以扩展已有 VMA；不能合并时，才分配新的 `vm_area_struct`，填写起止地址、标志、页保护和后备信息，再存入 VMA 迭代器指向的 Maple Tree。

反过来，`mprotect()`、`munmap()` 等操作只覆盖原 VMA 的一部分时，内核可能需要拆分边界；解除中间一段映射，还可能把一个概念区间变成左右两个 VMA。之后，兼容的相邻区间也可能再次合并。

因此：

- `map_count` 是当前 VMA 对象数量，不是历史 `mmap()` 调用次数。
- 一个源代码层面的分配可能跨越多个 VMA。
- 多次相邻映射也可能最终由一个 VMA 表示。
- VMA 指针和边界不能在缺少正确锁与生命期保证时长期缓存。

堆扩展也使用同一套区间管理思想。`mm/mmap.c:do_brk_flags()` 会尝试扩展兼容的已有 VMA；不能扩展时创建匿名 VMA，存入树中，并更新 `map_count`、`total_vm` 和 `data_vm`。

## 7. 线程共享 mm，fork 复制地址空间

`task_struct` 中同时有 `mm` 和 `active_mm`。对普通用户线程，最主要的是 `mm`：同一进程的线程通常通过 `CLONE_VM` 共享同一个 `mm_struct`，所以一个线程建立或解除映射，其他共享该地址空间的线程也会看到布局变化。

`kernel/fork.c:copy_mm()` 清楚地体现了分支：

- 带 `CLONE_VM` 时，增加旧 `mm` 的引用并直接共享。
- 不带 `CLONE_VM` 时，调用 `dup_mm()` 创建新的 `mm_struct`。

复制路径中的 `dup_mmap()` 会复制 VMA 的 Maple Tree 和各 VMA 元数据，并处理文件、匿名反向映射、策略等关系。普通 `fork()` 不会因此立刻把所有用户物理页复制一份；页表复制与写保护会为后续写时复制建立条件。

这里也要避免一句过度简化的话：**Linux 调度的对象是 task，地址空间并不严格等于“进程对象”。** 多个 task 可以共享一个 `mm_struct`；内核线程的 `mm` 还可以为 `NULL`，运行时借用 `active_mm`。本文后续讨论默认限定在具有用户地址空间的任务。

## 8. 修改布局与修改页表使用不同同步边界

`mm_struct` 中同时出现 `mmap_lock` 和 `page_table_lock`，说明地址空间并不是只靠“一把内存锁”保护。

- VMA 拓扑、边界和映射属性的常规读取通常要求持有 `mmap_lock` 读锁，修改通常要求写锁。
- 页表更新使用相应层级的页表锁；`page_table_lock` 还保护部分计数和结构。
- 开启 `CONFIG_PER_VMA_LOCK` 时，VMA 还有额外的每 VMA 锁与序列状态，但它不能被概括为替代所有 `mmap_lock` 规则。
- RCU 可参与对象生命期与无锁读取路径，但调用者必须遵守具体辅助函数的契约。

例如，本地 `find_vma()` 明确调用 `mmap_assert_locked(mm)`；这提醒读者：找到一个指针只是第一步，还要保证遍历和使用期间对象没有被并发拆分或释放。

进程退出时，`mm/mmap.c:exit_mmap()` 遍历 `mm_mt`，解除映射、释放页表，再关闭和释放 VMA，最后销毁 Maple Tree。这里的顺序也说明 VMA、页表和 `mm_struct` 各有生命期，但它们必须按地址空间退出协议协同收尾。

## 9. 从 /proc/pid/maps 观察 VMA

可以选择一个有权限读取的进程：

```bash
target_pid=$$
cat /proc/$target_pid/maps
cat /proc/$target_pid/smaps
```

如果安装了 `pmap`，也可以使用：

```bash
pmap -x $target_pid
```

`maps` 中每行通常对应一个 VMA 视图，包含起止地址、权限、文件偏移、设备号、inode 和可选路径或名称。`fs/proc/task_mmu.c:show_map_vma()` 直接从 `vm_start`、`vm_end`、`vm_flags`、`vm_pgoff`、`vm_file` 等信息组织输出，并为初始堆、初始栈等区域添加名称。

但“通常一行对应一个 VMA”不等于它展示了一切：

- `maps` 不列出每个虚拟页当前是否已有 PTE。
- 它不能直接告诉你某页对应哪个物理页帧。
- 它不保证两次读取之间地址空间没有变化。
- 相同路径出现多行并不异常，代码段、只读数据、可写数据可能有不同权限和文件偏移。
- `[heap]`、`[stack]` 是特定初始区域的标记，不代表所有匿名分配都集中在那里。

需要驻留、PSS、匿名页、共享页等更细统计时，再看 `smaps` 或 `smaps_rollup`。这些统计成本更高，且受内核配置与访问权限限制。

### 一个不伪造输出的观察方法

可以让一个测试程序分阶段执行匿名 `mmap`、逐页写入和 `munmap`，每个阶段暂停，然后分别记录：

```bash
cat /proc/$target_pid/maps
rg '^(Size|Rss|Pss|Anonymous):' /proc/$target_pid/smaps
```

预期关系应表述为待验证假设：建立 VMA 后虚拟区间出现；实际触碰页面后相应驻留统计通常增长；解除映射后区间消失。具体地址、合并结果、RSS 增量和时序由运行内核、分配器、THP 与并发回收等因素决定，不能从本文基线凭空写出固定结果。

## 10. 几个常见误解

| 常见说法 | 更准确的理解 |
| --- | --- |
| 一个进程只有一个 VMA | 一个用户地址空间通常有许多 VMA，`mm_struct` 是整体上下文 |
| 一个 VMA 就是一段物理连续内存 | VMA 描述虚拟地址区间，物理页可以按需分配且不要求整体连续 |
| 有 VMA 就一定有物理页 | 映射可先建立，页表项和物理页可在访问时按需建立 |
| 每次 mmap 都新增一个 VMA | 相邻兼容映射可能合并，局部修改也可能拆分 |
| find_vma 返回非空就说明地址有效 | 地址位于空洞时，它可能返回后面的下一个 VMA |
| fork 立即复制全部内存 | 新地址空间会复制管理结构并建立写时复制条件，物理数据通常按写入需要复制 |
| maps 就是页表的文本形式 | maps 主要是 VMA 视图，不展开每个页表项 |

## 11. 沿源码建立阅读闭环

建议按下面顺序阅读本地 openEuler 源码：

| 顺序 | 源码入口 | 要确认的问题 |
| --- | --- | --- |
| 1 | `include/linux/sched.h`：`task_struct.mm`、`active_mm` | task 如何关联地址空间？ |
| 2 | `include/linux/mm_types.h`：`mm_struct` | VMA 索引、页表根、布局、统计和锁放在哪里？ |
| 3 | `include/linux/mm_types.h`：`vm_area_struct` | 一个区间保存哪些规则和后备关系？ |
| 4 | `include/linux/mm.h` 与 `mm/mmap.c`：`find_vma()`、`vma_lookup()` | 给定地址的查找语义有何不同？ |
| 5 | `mm/mmap.c`：`__mmap_region()`、`do_brk_flags()`、`exit_mmap()` | VMA 如何创建、合并、记账与销毁？ |
| 6 | `kernel/fork.c`：`mm_init()`、`dup_mmap()`、`copy_mm()` | 线程共享和进程复制如何处理 mm 与 VMA？ |
| 7 | `fs/proc/task_mmu.c`：`show_map_vma()` | `/proc/<pid>/maps` 如何投影 VMA 信息？ |

读完后，可以用三个问题检查理解：为什么一个合法 VMA 中的地址仍可能触发缺页？为什么 `find_vma()` 的非空返回值还不够？为什么两个线程修改映射时会影响彼此，而普通 `fork()` 后不会共享同一棵 VMA 树？

能够分别从 VMA 规则、Maple Tree 查找和 `mm_struct` 共享关系回答这三个问题，就已经抓住了进程地址空间的骨架。下一步可以继续追踪 `malloc`、`brk` 与 `mmap` 如何改变这套结构，再进入缺页处理与页表建立路径。

## 参考与源码依据

- [内存管理知识地图](/os/memory/)。
- [上一篇基础文章：虚拟内存、驻留内存与物理内存占用有什么区别？](/posts/linux-virtual-resident-physical-memory/)。
- `include/linux/mm_types.h`：`struct mm_struct`、`struct vm_area_struct`、`VMA_ITERATOR`。
- `include/linux/mm.h`：`find_vma()` 声明、`vma_lookup()`。
- `mm/mmap.c`：`find_vma()`、`__mmap_region()`、`do_brk_flags()`、`exit_mmap()`。
- `kernel/fork.c`：`mm_init()`、`dup_mmap()`、`dup_mm()`、`copy_mm()`。
- `fs/proc/task_mmu.c`：`show_map_vma()` 与 `/proc/<pid>/maps` 的序列操作。
- `Documentation/core-api/maple_tree.rst`、`Documentation/mm/page_tables.rst`。

以上源码路径均相对于 `/home/wangyi/openEuler-kernel` 仓库根目录，字段与实现以文首提交为准。
