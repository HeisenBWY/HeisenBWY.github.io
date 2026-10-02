---
title: "KSM 如何发现并合并内容相同的匿名页？"
date: 2026-09-28T01:30:00+08:00
description: "从两棵内容寻址红黑树、ksmd 扫描游标与写保护换页三件事入手，拆解 KSM 的合并漏斗、私有反向映射与统计口径，并梳理 per-VMA 锁的优化方向。"
categories: ["OS"]
tags: ["Linux", "内存管理", "内核源码", "openEuler", "KSM"]
---

同一台机器上跑着几十个相似的虚拟机或容器，它们的匿名内存里有大量内容完全相同的页。fork 的写时复制帮不上忙——这些进程之间没有亲缘关系。KSM（Kernel Samepage Merging）就是为这种场景准备的：**不问出身，只看内容**，把内容相同的匿名页合并成一个共享的物理页。

理解 KSM 只需要抓住三件事：

1. **两棵按页内容组织的红黑树**——stable 树存已合并的页，unstable 树存候选页；
2. **一个单内核线程 ksmd**——拿着全局唯一的扫描游标，逐进程、逐地址地巡视；
3. **写保护加换页**——合并时把页变成只读，再替换 PTE 指向共享页，写入时靠 COW 恢复私有副本。

{% note info no-icon %}
**研究基线**

源码基线：openEuler 内核 `OLK-6.6` 分支，提交 `9c770f673dd4`，Makefile 版本为 `6.6.0`。该分支包含发行版扩展与回合补丁，结构字段和实现细节以此提交为准。本文是概念与源码阅读笔记，没有运行内核实验；文中引用的性能数据来自补丁作者在邮件列表公布的测试，非本文实测。
{% endnote %}

## 1. 怎么让一段内存被 KSM 盯上

KSM 默认完全关闭，启用分两步：先让 ksmd 跑起来，再给目标内存打标。

```bash
echo 1 > /sys/kernel/mm/ksm/run
```

打标有两条路，粒度不同：

| | `madvise` 路径 | `prctl` 路径 |
|---|---|---|
| 接口 | `madvise(addr, len, MADV_MERGEABLE)` | `prctl(PR_SET_MEMORY_MERGE, 1)` |
| 粒度 | 指定区间（按 VMA 生效） | 整个进程，含未来新 VMA |
| 新 `mmap` 的内存 | 不覆盖，需再调一次 | 自动覆盖 |
| 取消 | `MADV_UNMERGEABLE` 逐区间拆 | `prctl(..., 0)` 一键全拆 |
| 引入版本 | 2.6.32 | 6.4 |

`madvise` 路径进入 `mm/ksm.c` 的 `ksm_madvise()`，给 VMA 设置 `VM_MERGEABLE` 标志；首次调用时经 `__ksm_enter()` 把这个 `mm_struct` 挂进 ksmd 的扫描链表。`prctl` 路径进入 `ksm_enable_merge_any()`，给 mm 设置 `MMF_VM_MERGE_ANY` 后，此后每次 `mmap` 都会经 `ksm_add_vma()` 自动给新 VMA 打标。

一个容易踩的坑：`madvise(MADV_MERGEABLE)` 对不兼容的 VMA（共享映射、`VM_DONTEXPAND`、hugetlb 等，见 `vma_ksm_compatible()` 的判断）会**静默忽略**——返回成功但实际没打标，用户态无从感知。

openEuler 在这之上还加了一层 cgroup 便捷入口：`memory.ksm`。对它写 1 等价于给 cgroup 内**当前所有**进程逐个执行 `prctl`（`memcontrol.c` 的 `memcg_set_ksm_for_tasks()`），读它则实时累加组内进程的 KSM 统计。注意它是一次性快照语义——之后新 fork 的进程不会自动生效，也不是层级聚合，本质上还是把批处理搬进了内核，扫描本身仍然是全局的。

## 2. 核心数据结构：一个 mm 一条链，一棵树一个使命

`mm/ksm.c` 开头定义了三个关键结构，配合两张红黑树构成整个体系：

```text
ksm_mm_head (全局链表头)
   │
   ├── mm_slot (进程A) ── rmap_item ── rmap_item ── ...   ← 单链: 该进程所有被跟踪地址
   ├── mm_slot (进程B) ── rmap_item ── ...
   └── ...

stable 树 (按页内容排序)                unstable 树 (每轮扫描推倒重建)
   stable_node "KSM页的名片"              rmap_item "冷候选页"
     ├─ rmap_item (进程A, addr1)           (rb_node 挂树)
     ├─ rmap_item (进程C, addr2)
     └─ ...
```

- **`ksm_mm_slot`**：每个被跟踪的 mm 一个，串起该进程所有 `rmap_item`，并链在全局 `ksm_mm_head` 上。
- **`ksm_rmap_item`**：记录"某进程的某虚拟地址"当前的状态——上轮 checksum、是否在 unstable 树、是否已合并。地址低位复用为状态标志（`UNSTABLE_FLAG`、`STABLE_FLAG`）和轮次号。
- **`ksm_stable_node`**：代表一个已合并的 KSM 物理页，`kpfn` 指向页帧，`hlist` 挂着所有映射它的 rmap_item。

两棵树的分工是理解 KSM 的关键：

**stable 树存"上岸"的页**。能进这棵树的页都是 KSM 页，全部写保护，内容不会再变，所以按内容排序的树序永远可靠——这棵树从不重建。查找命中即可直接复用。

**unstable 树存"连续两轮 checksum 不变"的候选页**。这些页没有写保护，内容随时可能变，树序可能悄悄失效。对策是两个：插入前要求 checksum 与上轮一致（热页进不来），且每扫完一整圈全部清空重建（坏序最多存活一圈）。红黑树只按颜色维持平衡，树"内容乱序"并不会让它失衡，只是查不准——清空重建保证了下一圈的查找正确性。

一个常见误解是"所有被扫描的页都挂在两棵树上"。恰恰相反：**绝大多数页哪棵树都不在**。每个被跟踪地址都有 rmap_item 充当书签（挂在 mm 的单链上），但只有通过筛选的少数才进 unstable 树，合并成功者才进 stable 树。sysfs 里的统计公式直接印证了这一点：

```text
pages_volatile = ksm_rmap_items − pages_shared − pages_sharing − pages_unshared
```

`ksm_rmap_items` 是全体被跟踪地址数，减去 stable 相关（shared + sharing）和 unstable（unshared），剩下的 `pages_volatile` 就是"哪棵树都不在"的自由态——真实负载里它往往最大。

## 3. ksmd 怎么扫：一个游标，断点续扫

ksmd 是 `ksm_init()` 里启动的**唯一**内核线程（`ps` 里名为 `ksmd`），主循环很朴素：

```c
while (!kthread_should_stop()) {
        mutex_lock(&ksm_thread_mutex);
        ksm_do_scan(ksm_thread_pages_to_scan);   /* 默认 100 页 */
        mutex_unlock(&ksm_thread_mutex);
        schedule_timeout(msecs_to_jiffies(ksm_thread_sleep_millisecs)); /* 默认 20ms */
}
```

三个经常被误解的行为：

**配额只计"真实页"**。`scan_get_next_rmap_item()` 用 `walk_page_range_vma()` 一次跨过整段没有 PTE 的地址空洞，直接定位下一个实际存在的匿名页——跳洞不消耗 `pages_to_scan` 配额。

**断点续扫**。全局唯一的 `struct ksm_scan` 游标记录三元组（当前 mm_slot、地址、rmap 单链位置）。配额用完直接睡，醒来原样继续：进程 A 扫到第 50 页睡着，下次醒来还是 A 的第 51 页。

**配额跨进程连续消耗**。一个 mm 的 VMA 遍历完后，扫描就地跳到链表下一个 mm 继续（`scan_get_next_rmap_item()` 里的 `goto next_mm`），同一次配额内可以横跨多个进程。绕一整圈回到链表头时 `seqnr` 加一，下一圈开头清空重建 unstable 树。

还有一个反直觉的设计：新进程的 mm 被 `__ksm_enter()` 插到**游标正后方**而不是链表尾——新来的进程几乎立刻被扫到，避免 fork 后立刻 exec 的进程白白建一堆 rmap_item。代价是没有任何公平性调度：链表前排的进程永远享受更高扫描频率，这也是大内存机器上 KSM 收敛慢的原因之一。

## 4. 合并漏斗：每个页的五级筛选

对扫描到的每个页，`cmp_and_merge_page()` 按固定顺序过五级漏斗，每一级都在淘汰：

```text
被扫描的页
  │
  ├─① 查 stable 树命中 → 复用现成 KSM 页, rmap_item 挂上 hlist (最理想路径)
  │
  ├─② checksum 与上轮不同 → 热页, 更新记录后放弃
  │
  ├─③ checksum 等于全零页 → PTE 直接换指 ZERO_PAGE (需 use_zero_pages=1)
  │
  ├─④ 查 unstable 树命中 → 两页合一, 新建 stable_node, 双双"上岸"
  │
  └─⑤ 都没命中 → 插入 unstable 树, 等下轮配对
```

几个值得展开的细节：

**每次重扫先"下树"**。漏斗最前面有无条件的 `remove_rmap_item_from_tree()`——unstable 树里的页被再次扫到时先被摘出来，只有走到漏斗最底端才重新插回去。unstable 的成员资格只维持"从插入到下次被扫"这一小段。

**零页合并不进任何树**。换成 `ZERO_PAGE()` 的页 PTE 直接指向全局零页，没有 stable_node，下轮扫描时 `vm_normal_page()` 得到的不是匿名 folio，天然被跳过。这就是为什么零页节省需要单独的计数器（openEuler 给 mm 加了 `ksm_zero_pages`，`/proc/<pid>/ksm_stat` 可见）。

**配对失败还有一次机会**。两个候选页属于同一个 THP 复合页时合并会失败，此时会尝试 `split_huge_page()` 拆开，留给下轮再试。

## 5. 合并那一瞬间：写保护、换 PTE、COW 兜底

真正"省内存"的动作分两步，都在 `try_to_merge_one_page()` 的调用链里：

**第一步，`write_protect_page()` 冻结第一个页**。把该地址的 PTE 改成只读，这个页从此升级为 KSM 页。这里有一段经典的竞态处理：先 `ptep_clear_flush` 清掉 PTE 并刷 TLB，再检查 `mapcount + 1 == page_count`——多出来的那一个引用如果存在，说明有 GUP 或 direct I/O 正在钉着这个页，此时必须放弃，否则合并后内核外的旧引用会看到别人写入的数据。对设置了 `PageAnonExclusive` 的页还要先 `folio_try_share_anon_rmap_pte()` 转移排他性。

**第二步，`replace_page()` 偷梁换柱**。在 pte 锁内校验 `pte_same()` 后，把第二个页所在地址的 PTE 替换为指向共享页的新 PTE，旧页解除映射、释放引用——**这一刻内存真正省了下来**。

之后任何进程写这个地址，会触发写保护缺页，走 `do_wp_page` → `ksm_might_need_to_copy()` 发现是 KSM 页，复制一份私有副本恢复写入。KSM 主动撤并（比如 `MADV_UNMERGEABLE`）则走 `break_cow()`，手段是往目标地址写一个字节，人为触发 COW。

## 6. KSM 的私有反向映射

普通匿名页的反向映射（"这个物理页被谁映射"）走 anon_vma 链，但 KSM 页被 N 个**毫无亲缘关系**的进程映射，没有任何一个 anon_vma 能完整描述它。于是 KSM 劫持了 `page->mapping`——存的是 `(stable_node 指针 | PAGE_MAPPING_KSM)`，整条链变成：

```text
page → stable_node → hlist → 每个 rmap_item → (mm, address) → PTE
```

`rmap_walk_ksm()` 实现这条遍历，被页回收（`try_to_unmap`）、页迁移、内存故障（`collect_procs_ksm`）等所有"拿着物理页找 PTE"的子系统复用。有趣的是它**部分回归了 anon_vma**：rmap_item 里存着合并那一刻的 `anon_vma` 指针，从地址定位 VMA 仍然靠它；而且函数末尾会做第二遍遍历，专门覆盖 fork 出来的子进程——子进程的 PTE 复制自父进程，但 KSM 不为子进程建 rmap_item（懒策略），它们的映射藏在父进程 rmap_item 的 anon_vma 子树里。

`get_ksm_page()` 是这条链的"安检门"。stable_node 不持有页的引用计数（否则 swap/回收释放页要等 ksmd 转过来，可能几分钟），所以每次从 stable_node 取页都要验钥匙：核对 `page->mapping` 是否仍指回这个 stable_node，再用 `get_page_unless_zero` 拿引用。页被释放时 mapping 被清空，这一校验即失败，节点随之从树上摘除。

跨 NUMA 节点迁移的页还有个中转站：`migrate_nodes` 链表。`merge_across_nodes=0` 时 stable 树按节点分棵，页被迁移到别的节点后节点留在旧树里就再也搜不到了，于是先摘下来挂在 `migrate_nodes` 上，每圈扫描开头重新插回正确的树。

## 7. 统计口径与收益判断

全局计数在 `/sys/kernel/mm/ksm/`：

| 计数 | 含义 |
|---|---|
| `pages_shared` | KSM 页数量（stable 树里的内容份数） |
| `pages_sharing` | 因合并而省掉的页数量 |
| `pages_unshared` | 独一无二、无法合并的候选页 |
| `pages_volatile` | 状态飘忽的页（热页等） |

**经验法则：`pages_sharing > pages_shared` 才划算**。每个 KSM 页要多付一张 rmap_item（约 64 字节）和可能的 stable_node 链开销，大约占节省量的 1/16。

进程级看 `/proc/<pid>/ksm_stat`（openEuler 特性）：`ksm_rmap_items`、`ksm_merging_pages`、`ksm_zero_pages`，以及把零页也算进去的 `ksm_process_profit()`（`include/linux/ksm.h`）。cgroup 级看 `memory.ksm`，实时累加组内直属进程。

## 8. 锁格局与正在发生的优化

当前 KSM 的锁分三层：`ksm_thread_mutex` 串行化每轮扫描（单线程模型的兜底锁）；`ksm_mmlist_lock` 保护 mm 链表；之下是逐页操作拿的 `mmap_read_lock(mm)`——这是热路径的大头，`get_mergeable_page()`、`try_to_merge_with_ksm_page()`、`break_cow()` 等每个页的操作都要拿一次**整个进程**的读锁。

问题在于 `mmap_lock` 是全生命周期的 rwsem：目标进程里任何无关 VMA 的 `mmap()/munmap()` 都会挡住 ksmd。2026 年 9 月，ZTE 的 Xu Xin 在 LKML 发了一组补丁（*mm/ksm: use per-VMA locking for find_mergeable_vma()*），思路是仿照 TCP zerocopy 的 `find_tcp_vma()`，新增 `find_mergeable_vma_locked()`：用 `vma_start_read_unlocked()` 查找并只读锁**目标那一个 VMA**，四个热路径调用点全部转换，`folio_walk_start()` 的锁断言相应扩展出 per-VMA 模式。按补丁作者公布的微基准（来源为 LKML 邮件，非本文实测）：4 个线程持续 mmap/munmap 干扰下，32 MiB 合并区从 72.45 秒降到 36.61 秒，约快 50%；无干扰时持平。

这个方向在语义上是安全的：KSM 拿锁只为了确认"地址落在 `VM_MERGEABLE` 的 VMA 里"并安全走页表，不需要全 mm 的一致性快照；真正的临界区（pte 锁、page 锁）本来就在 mmap_lock 之下。需要注意的是，该补丁的基线是更新的上游内核（依赖 `folio_walk`、`vma_start_read_unlocked()` 等 6.6 之后的基础设施），扫描游标本身持 `mmap_read_lock` 遍历 VMA 的部分也尚未转换。

## 9. 怎么观察一台开了 KSM 的机器

```bash
uname -r                                  # 先确认内核版本, KSM 各接口随版本演进
cat /sys/kernel/mm/ksm/run                # 0=stop 1=run 2=unmerge+stop
grep -E 'shared|sharing|unshared|volatile' /sys/kernel/mm/ksm/pages_*  # 全局收益
cat /proc/<pid>/ksm_stat                  # 进程级 (openEuler)
cat /sys/fs/cgroup/<path>/memory.ksm      # cgroup 级 (openEuler)
```

调整扫描节奏的三个主要旋钮：`pages_to_scan`（每轮配额，默认 100）、`sleep_millisecs`（默认 20ms）、`use_zero_pages`（零页合并，默认 0）。想验证去重效果又不想影响生产，可以只在 QEMU 隔离环境里开两个相同负载的进程对比 `pages_sharing` 的增速。

## 10. 小结与下一步

一条主线串起来：**打标（madvise/prctl）→ ksmd 断点续扫 → checksum 漏斗淘汰热页 → stable 优先复用、unstable 两两配对 → 写保护加换 PTE 合并 → 写入时 COW 还原**。KSM 用"两棵内容寻址的树 + 一套绕开 anon_vma 的私有 rmap + 不持引用的双向指针校验"，换来了对无亲缘进程的去重能力，代价是每页一次的 mm 读锁和单线程扫描的收敛速度。

下一篇文章可以从两个方向继续：一是 `ksm_might_need_to_copy()` 与 swap 的交互（KSM 页换出后如何保持合并语义）；二是 smart KSM / `merge_across_nodes` 与 chain-dup 机制在超大共享下的行为。

## 参考

- 本地源码：`mm/ksm.c`、`include/linux/ksm.h`、`mm/memcontrol.c`（`memory.ksm`）、`fs/proc/base.c`（`ksm_stat`）
- 内核自带文档：`Documentation/ksm.rst`（`mm/ksm.c` 文件头注释与之一致）
- Xu Xin (ZTE), *[PATCH 0/4] mm/ksm: use per-VMA locking for find_mergeable_vma()*，LKML，2026-09-11
