---
title: "CPU 如何通过页表和 TLB 把虚拟地址转换为物理地址？"
date: 2026-10-09T22:58:24+08:00
description: "以 x86-64 为例，从 TLB 命中、硬件多级页表遍历到缺页异常与 TLB shootdown，串起一次虚拟地址翻译的完整路径。"
categories: ["OS"]
tags: ["Linux", "内存管理", "页表", "TLB", "x86-64", "内核源码", "openEuler"]
cover: /img/covers/linux-cpu-page-table-tlb.png
---

程序执行 `*p`、数组访问或取下一条指令时，指令里使用的通常是虚拟地址；内存条却按物理地址工作。CPU 每次访存都要查一遍庞大的页表吗？TLB miss 是不是缺页异常？页表项改了以后，CPU 又为什么可能继续使用旧映射？

**最短答案是：CPU 先查 TLB；命中时直接得到页帧和权限，未命中时由 MMU 遍历内存中的多级页表。只有页表遍历发现映射不存在、权限不允许或页表项非法时，才触发缺页异常并进入内核。**

{% note info no-icon %}
**研究基线**

上游基础机制：Linux `v6.6`，提交 `ffc253263a1375a65fa6c9f62a893e9767fbebfa`；6.6.y 发布与 changelog 检查到 `6.6.158`（2026-10-03）；openEuler：`OLK-6.6`，提交 `9c770f673dd43016572429acaf1ac6a89e42a310`；后续上游检查到正式版 `v7.2`，并单独观察 `v7.3-rc6`。本文没有运行性能实验，地址和时延仅作机制示意。

正文默认讨论开启分页的 x86-64 普通用户地址访问、4 KiB 基础页和四级硬件页表；五级页表、大页与其他体系结构的差异会明确指出。
{% endnote %}

## 1. 先把三个角色分开

| 角色 | 在哪里 | 保存什么 | 主要作用 |
| --- | --- | --- | --- |
| 页表 | 普通内存中的内核数据结构 | 虚拟页到物理页的映射、权限和状态 | 地址翻译的事实来源 |
| TLB | CPU 核心内的硬件缓存 | 最近使用的页表翻译结果 | 避免每次访存都走多级页表 |
| MMU | CPU 的内存管理硬件 | 执行 TLB 查询、页表遍历和权限检查 | 把虚拟地址变成可用于访存的物理地址 |

页表属于一个地址空间。Linux 用 `mm_struct.pgd` 记录页表根；在 x86-64 上，当前活动页表根的物理地址由 `CR3` 参与提供。TLB 不是另一份由内核逐项同步维护的页表，而是处理器根据页表遍历结果形成的缓存。

下面这张图先给出全路径。阅读时重点看三个分支：TLB 命中、TLB miss 后页表遍历成功，以及页表遍历无法完成翻译后触发 `#PF`。

<figure class="kernel-diagram">
  <div class="kernel-diagram-frame">
    <iframe src="/diagrams/linux-cpu-page-table-tlb/address-translation.html?embed=1&amp;theme=light" title="CPU 通过 TLB 与页表完成地址翻译的流程" loading="lazy"></iframe>
  </div>
  <figcaption>TLB miss 通常仍由硬件解决；只有页表状态无法满足本次访问时才进入 Linux 缺页处理。 <a href="/diagrams/linux-cpu-page-table-tlb/address-translation.html" target="_blank" rel="noopener">打开完整交互图 ↗</a></figcaption>
</figure>

## 2. 虚拟地址怎样选择每一级页表项

页表使用多级树，而不是为整个虚拟地址空间准备一个巨大的线性数组。未使用的大段地址只需要在较高层保留一个无效项，不必为下面所有页面分配页表。

Linux 的通用页表层级写作：

```text
PGD → P4D → PUD → PMD → PTE → 物理页
```

Linux 固定使用这套五级抽象；硬件层级较少时，中间层会被“折叠”。在常见的 x86-64 四级分页中，`P4D` 被折叠，48 位规范虚拟地址的低 48 位可以这样拆分：

```text
  63                    48 47       39 38       30 29       21 20       12 11        0
 +------------------------+-----------+-----------+-----------+-----------+-----------+
 |  bit 47 的符号扩展      | PGD/PML4  | PUD/PDPT  |  PMD/PD   |  PTE/PT   | 页内偏移  |
 +------------------------+-----------+-----------+-----------+-----------+-----------+
                              9 bit       9 bit       9 bit       9 bit      12 bit
```

4 KiB 页的页内偏移占 12 位；每级索引 9 位，可以选择 512 个 8 字节页表项。于是一个 4 KiB 页表页刚好容纳 512 项。

例如虚拟地址 `0x00007f123456789a` 的拆分结果是：

| 部分 | 值 | 用途 |
| --- | ---: | --- |
| PGD 索引 | `0xfe` | 在顶级表选择一项 |
| PUD 索引 | `0x48` | 选择下一级表 |
| PMD 索引 | `0x1a2` | 选择下一级表 |
| PTE 索引 | `0x167` | 找到 4 KiB 页的叶子映射 |
| 页内偏移 | `0x89a` | 在最终物理页内定位字节 |

索引只负责沿树找到叶子项。最终物理地址的基本形式是：

```text
物理地址 = 页表项中的物理页帧基址 + 虚拟地址的页内偏移
```

如果机器启用 x86 五级分页，硬件在顶部再增加 PML5；Linux 的 `PGD` 对应 PML5，`P4D` 对应 PML4，可使用的虚拟地址位扩展到 57 位。不要把“Linux 源码总写五级”误解成“所有机器都真的访问五级页表”。[Linux 页表文档](https://docs.kernel.org/6.6/mm/page_tables.html)对层级和折叠做了更完整的架构无关说明。

## 3. 快速路径：TLB 命中

一条 load、store 或取指操作产生虚拟地址和访问类型后，MMU 会先查询相应的 TLB。现代处理器通常有数据 TLB、指令 TLB以及更高层的共享翻译缓存；具体层次、容量和替换策略属于微架构实现，不能从 Linux 通用源码推导成固定结构。

可以把一条 TLB 记录简化为：

```text
(虚拟页号, 地址空间标签) → (物理页帧号, 页大小, 访问权限, 状态)
```

这里的地址空间标签在 x86 上通常与 PCID 机制有关。它让不同地址空间的 TLB 项可以带标签共存，减少切换 `CR3` 时必须清空的翻译，但不改变“每个进程拥有自己的用户页表”这一事实。

命中后，MMU 仍要检查本次访问是否满足权限，例如：

- 页是否存在；
- 用户态能否访问；
- 写操作是否允许；
- 取指是否被 NX 禁止；
- 保护键等附加机制是否允许。

检查通过后，页帧基址与页内偏移组合成物理地址，再去访问缓存层次或内存。这里还有一个常见混淆：**TLB 缓存地址翻译，CPU Cache 缓存数据或指令；两者缓存的不是同一种东西。**

## 4. TLB miss：硬件遍历页表，不是立刻进入内核

TLB 没有对应翻译时，x86-64 的硬件 page walker 从 `CR3` 指向的根开始，按虚拟地址的各级索引读取页表项。页表本身位于内存，因此一次 TLB miss 可能引入多次缓存或内存访问；处理器还可能使用 page-walk cache 缓存中间层结果。

每一级页表项都不只是一个“下一级地址”。以 x86 为例，相关状态包括 `Present`、`R/W`、`User/Supervisor`、`Accessed`、`Dirty`、`NX`，以及叶子大页使用的 `PS` 等。Linux 6.6 在 `arch/x86/include/asm/pgtable_types.h` 中以 `_PAGE_PRESENT`、`_PAGE_RW`、`_PAGE_USER`、`_PAGE_ACCESSED`、`_PAGE_DIRTY`、`_PAGE_NX` 等宏表达这些位。

页表遍历有三类结果：

1. 找到有效叶子项且权限允许：形成翻译，通常把结果填入 TLB，然后重做原访问。
2. 在较高层遇到大页叶子：提前结束遍历。x86-64 中 PMD 级可以映射 2 MiB，PUD 级可以映射 1 GiB；页内偏移也相应变大。
3. 遇到不存在项、权限冲突、保留位错误等：处理器触发缺页异常 `#PF`。

大页减少页表层数和 TLB 项压力，但并不保证应用更快；连续物理内存、内部碎片、回收和拆分成本也要一起考虑。

{% note warning no-icon %}
**TLB miss 不等于 page fault**

TLB miss 只表示翻译缓存没命中。只要页表里已有有效映射，硬件完成 page walk 后就能继续，内核通常不会介入。page fault 表示硬件遍历或权限检查无法直接满足本次访问。
{% endnote %}

## 5. `#PF` 之后，Linux 怎样决定修复还是报错

x86 触发缺页异常时，会把故障线性地址放入 `CR2`，同时提供错误码，区分不存在页、读写、用户/内核、取指、保留位和保护键等原因。

Linux 6.6 的典型用户地址路径是：

```text
arch/x86/mm/fault.c
exc_page_fault()
  → handle_page_fault()
    → do_user_addr_fault()
      → handle_mm_fault()
        → __handle_mm_fault()
          → handle_pte_fault()
```

`do_user_addr_fault()` 先结合错误码和 VMA 判断这次访问是否属于有效区域、权限是否合理；通用内存管理代码再根据叶子项状态选择动作，例如：

- 首次访问匿名映射：分配物理页，或在合适的读场景映射共享零页；
- 文件映射尚未建立：从 Page Cache 取得页面，必要时发起 I/O；
- 页面已经换出：从 Swap 恢复；
- 写只读的 COW 映射：准备可写私有副本；
- 地址没有对应 VMA或权限非法：通常向用户线程发送 `SIGSEGV`；
- 映射存在但后备存储发生错误：某些场景可能得到 `SIGBUS`。

如果内核成功建立或修复页表项，异常返回后处理器会重试那条指令。这不是“跳过出错指令继续向下”，而是让同一次访问重新经历地址翻译。

因此，“缺页”也不等于“磁盘读页”。匿名页首次分配、COW 写保护都可能是 minor fault；只有确实等待后备存储 I/O 等情况才会形成 major fault 语义。

## 6. 页表改了，为什么还必须刷新 TLB

TLB 命中时，CPU 不需要重新读取叶子页表项。若内核已经把某个 PTE 从物理页 A 改为物理页 B，而某个 CPU 仍保留旧 TLB 项，它就可能继续访问 A。

所以正确顺序不只是“写新页表项”，还要根据修改范围和体系结构要求失效旧翻译。Linux 提供 `flush_tlb_page()`、`flush_tlb_range()`、`flush_tlb_mm()` 和 `flush_tlb_all()` 等接口；x86 可能选用 `INVLPG`、重新装载 `CR3`、`INVPCID` 或其他能力，具体选择由特性与范围决定。[Linux Cache/TLB flush 文档](https://docs.kernel.org/6.6/core-api/cachetlb.html)明确要求：刷新返回后，相关地址不能再使用修改前的翻译。

在多核系统中问题更复杂：同一 `mm_struct` 可能正在多个 CPU 上运行，每个 CPU 都可能缓存它的翻译。修改映射的 CPU 需要让相关远端 CPU 也完成失效，这通常被称为 **TLB shootdown**。它可能涉及 IPI、CPU 掩码、批量刷新和代际记录；这些都是降低跨核同步成本的实现手段。

上下文切换也不必机械地理解为“每次都清空整个 TLB”。x86 PCID 可以为翻译加地址空间标签，Linux 还会维护 ASID/PCID 与 TLB generation 状态，尽量复用仍然有效的记录。优化的底线始终是：**任何 CPU 都不能继续使用已经失效且可能造成错误访问的旧翻译。**

## 7. 四个容易混在一起的概念

| 概念 | 表示什么 | 不等于什么 |
| --- | --- | --- |
| TLB hit | 找到缓存的翻译并通过权限检查 | 数据一定命中 L1/L2/L3 Cache |
| TLB miss | 翻译缓存里没有所需项 | 缺页异常、磁盘 I/O |
| page fault | 当前页表状态不能直接完成访问 | 程序一定有 bug |
| 页不在 RAM | 数据当前没有驻留物理页 | 虚拟地址无效 |

另一个边界是 VMA 与页表：VMA 描述一段地址“应该如何映射”，页表描述某个虚拟页“此刻怎样翻译”。VMA 已经存在而 PTE 尚未建立，是按需分配的正常状态；缺页处理正是把两层规则衔接起来。

## 8. 从源码抓住哪些入口

| 上游 Linux `v6.6` 路径或符号 | 阅读重点 |
| --- | --- |
| `Documentation/mm/page_tables.rst` | 页表层级、折叠、大页与 MMU/TLB 总览 |
| `arch/x86/include/asm/pgtable_64_types.h` | 四级/五级分页的 shift 与每级项数 |
| `arch/x86/include/asm/pgtable_types.h` | x86 页表项的硬件位定义 |
| `arch/x86/include/asm/pgtable.h` | `pgd_offset()`、`p4d_offset()` 等软件遍历辅助函数 |
| `arch/x86/mm/fault.c` | `exc_page_fault()` 到 `do_user_addr_fault()` 的架构入口 |
| `mm/memory.c` | `handle_mm_fault()`、`__handle_mm_fault()`、`handle_pte_fault()` |
| `arch/x86/include/asm/tlbflush.h` | 刷新接口、PCID/ASID 和 TLB generation 数据结构 |
| `arch/x86/mm/tlb.c` | 上下文切换、本地与远端 TLB 刷新的 x86 实现 |

需要注意，内核源码中的 `pgd_offset()` 等函数是**内核软件读取或修改页表**时使用的接口；普通用户指令产生的 TLB miss 在 x86 上由硬件 page walker 处理，并不会调用一遍这些 C 函数。

## 9. 6.6 之后和 openEuler 改了什么

从 `v6.6` 检查到 `v7.2` 后，本文的基本心智模型没有改变；值得关注的变化主要落在 TLB 失效的正确性与批处理效率，而不是把地址翻译改成了另一条路径。

- 上游提交 [`3ef938c35035`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=3ef938c3503563bfc2ac15083557f880d29c2e64) 首次进入 `v6.15-rc1`，修复 x86 `flush_tlb_range()` 在清除普通 PMD 页表时没有正确表达“释放了页表”的问题。openEuler `OLK-6.6` 以提交 `84c653090a18` 回合，并关联 CVE-2025-22045。
- 上游提交 [`2f4ab3ac10e1`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=2f4ab3ac10e1476abb6ed55f0b5f176cf635e776) 首次进入 `v6.15-rc1`，让批量解除映射的 TLB 刷新携带范围，为减少无谓刷新打基础；openEuler 以 `f2eed8a0a509` 回合，并处理了架构分支冲突。
- 上游提交 [`83b0177a6c48`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=83b0177a6c4889b3a6e865da5e21b2c9d97d0551) 首次进入 `v6.18-rc2`，补上 `switch_mm_irqs_off()` 与并发 TLB 刷新之间所需的 SMP 顺序，避免上下文切换看不到新的 `tlb_gen`；openEuler 当前分支也包含该提交。

这些补丁共同说明，TLB 刷新不是一个无关紧要的性能附录，而是页表正确性的一部分。`v7.3-rc6` 仍属于未正式发布的开发状态，本文不把其中内容当成稳定接口承诺。

## 10. 怎样在当前系统观察

先确认运行环境。磁盘上的源码树不一定就是当前正在运行的内核：

```bash
uname -r
uname -m
getconf PAGESIZE
lscpu | rg 'Architecture|Address sizes'
```

观察进程页表内存开销，可以查看 `VmPTE`：

```bash
target_pid=$$
rg '^(VmSize|VmRSS|VmPTE):' /proc/$target_pid/status
```

如果系统提供相应 PMU 事件且权限允许，可先列出 TLB 事件，再选取适合本机型号的事件测量：

```bash
perf list | rg -i '(^| )([di]tlb|tlb)'
perf stat -e dTLB-loads,dTLB-load-misses -- ./your_program
```

不同 CPU 的可用事件和含义可能不同，虚拟机或 `perf_event_paranoid` 也会限制观测。不要把某一型号上的事件名写成所有 x86 机器的固定接口。

`/proc/<pid>/pagemap` 可以暴露页级状态，但 PFN 等信息受权限限制，并且读取结果只是一瞬间的观察；它也不会直接告诉你某个地址当前是否在某个 CPU 的 TLB 中。

## 11. 把一次地址翻译压缩成六句话

1. 指令产生虚拟地址和访问类型，MMU 先查询 TLB。
2. TLB 命中且权限允许时，页帧基址加页内偏移得到物理地址。
3. TLB miss 时，x86 硬件从 `CR3` 指向的根逐级遍历内存中的页表。
4. 有效叶子项会形成翻译并可被 TLB 缓存；大页可以在 PMD/PUD 层提前结束遍历。
5. 映射缺失或权限冲突会触发 `#PF`；Linux 根据 VMA 和页表状态修复映射，或发送信号。
6. 内核修改或删除映射后，必须让相关 CPU 的旧 TLB 项失效，才能保证页表变化真正生效。

下一篇可以顺着异常慢路径继续追问：申请了 1 GiB 虚拟内存后，第一次读和第一次写分别怎样进入匿名缺页、共享零页与实际物理页分配？
