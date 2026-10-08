---
title: "从建立映射到 munmap，地址空间经历了哪些变化？"
date: 2026-10-09T12:00:00+08:00
description: "以普通私有匿名映射为主线，跟踪 mmap、首次读写和 munmap 期间 VMA、页表、物理页、RSS、反向映射与 TLB 分别何时建立和撤销，并对照 openEuler 与后续上游演进。"
categories: ["OS"]
tags: ["Linux", "内存管理", "虚拟内存", "VMA", "页表", "内核源码", "openEuler"]
cover: /img/cover.jpg
---

调用 `mmap()` 成功后，进程已经“拥有”这段内存了吗？第一次读取和第一次写入为什么可能走不同路径？`munmap()` 返回时，VMA、页表、物理页和 CPU 的 TLB 又分别处于什么状态？

**一段普通私有匿名映射的生命期，不是“分配物理页—释放物理页”这么简单，而是四层状态依次变化：先登记 VMA 规则，访问时按页建立页表与后备页，解除映射时先从地址空间拓扑摘除目标区间，再撤销页级映射并完成 TLB 失效。**

{% note info no-icon %}
**研究基线**

上游基础实现为 Linux `v6.6`，提交 `ffc253263a13`；6.6.y 稳定修复检查到 kernel.org 在 2026-10-09 列出的 `6.6.158`。openEuler 对照 `OLK-6.6` 分支，提交 `9c770f673dd43016572429acaf1ac6a89e42a310`。后续上游演进检查到正式标签 `v7.2`，提交 `8d3ae59288f1`；另确认本地主线位于 `v7.3-rc6`，提交 `47324d3a5b3a`，RC 内容不作为稳定接口承诺。本文以启用 MMU 的普通私有匿名映射为主，文件映射和特殊映射只说明差异；没有运行内核实验，实验节给出可复现的只读观察方法。
{% endnote %}

## 1. 先用一张表看完整生命期

假设程序执行：

```c
p = mmap(NULL, len, PROT_READ | PROT_WRITE,
         MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
/* 读取、写入 p 中的若干页 */
munmap(p, len);
```

各阶段改变的对象并不相同：

| 阶段 | VMA / Maple Tree | 页表 | 后备页 | 常见统计变化 |
| --- | --- | --- | --- | --- |
| 调用前 | 目标范围是空洞 | 没有该范围的有效映射 | 无 | 无 |
| `mmap()` 返回 | 新建、扩展或合并 VMA | 普通匿名映射通常仍无 PTE | 通常还没有私有物理页 | `total_vm`、`data_vm` 等虚拟内存记账增加 |
| 第一次只读 | VMA 不变 | 可安装指向共享零页的只读特殊 PTE | 不一定分配私有页 | 缺页计数变化，私有匿名 RSS 不必增长 |
| 第一次写入 | VMA 通常不变 | 安装指向私有页的可写 PTE | 分配并记账匿名 folio，加入 rmap 与 LRU | 匿名 RSS、memcg 记账通常增长 |
| 部分 `munmap()` | 必要时拆分 VMA，目标子区间从树中消失 | 清除目标子区间 PTE | 删除本进程映射引用 | `total_vm` 与相应 RSS 减少；两侧 VMA 可继续存在 |
| 完整 `munmap()` 返回 | 原范围重新成为空洞 | 原页级翻译已撤销 | 无其他引用的匿名页才可真正释放 | TLB 失效完成，映射和驻留记账已更新 |

这张表最重要的结论是：**VMA、页表项和物理页是三套不同粒度、不同生命期的状态。** `mmap()` 主要建立第一层；缺页处理建立第二、第三层；`munmap()` 再按相反方向把它们拆开。

下面的生命周期图把主线和三个容易忽略的分支放在一起：首次访问可能使用零页、私有匿名页或文件页缓存；部分解除映射会留下左右 VMA；物理页也可能因为其他映射或引用继续存活。

<figure class="kernel-diagram">
  <div class="kernel-diagram-frame">
    <iframe src="/diagrams/linux-mmap-munmap-lifecycle/address-space-lifecycle.html?embed=1&amp;theme=light" title="从 mmap 到 munmap 的地址空间生命周期" loading="lazy"></iframe>
  </div>
  <figcaption>从地址空间空洞、VMA 登记、按需建立页级状态，到 munmap 拆分、摘除和完成 TLB 失效。 <a href="/diagrams/linux-mmap-munmap-lifecycle/address-space-lifecycle.html" target="_blank" rel="noopener">打开完整交互图 ↗</a></figcaption>
</figure>

## 2. mmap 第一步不是拿页，而是确定一段合法规则

在上游 Linux 6.6 中，常见系统调用路径可以概括为：

```text
mmap 系统调用
  → ksys_mmap_pgoff()
  → vm_mmap_pgoff()
      ├─ security_mmap_file()
      ├─ mmap_write_lock_killable(mm)
      └─ do_mmap()
           ├─ 校验长度、偏移、权限、文件与资源限制
           ├─ get_unmapped_area() 选择地址
           └─ mmap_region() 建立、扩展或合并 VMA
```

体系结构可能提供自己的系统调用包装，文件映射、hugetlb 和设备映射也有额外分支，所以这是一条典型路径，不是所有配置下完全相同的固定调用链。

### 地址和长度先被规范化

`mm/mmap.c:do_mmap()` 会拒绝零长度映射，把长度向页边界对齐，检查页偏移溢出、VMA 数量上限、`RLIMIT_MEMLOCK`、文件权限和可执行权限等条件。随后 `get_unmapped_area()` 根据地址提示、映射方向、体系结构约束和空洞情况选择一段地址。

`addr` 在没有 `MAP_FIXED` 时通常只是提示，返回地址可以不同；`MAP_FIXED_NOREPLACE` 要求目标区间完全空闲，否则返回 `-EEXIST`。普通 `MAP_FIXED` 更危险：`mmap_region()` 会先解除目标范围内已有映射，再安装新映射，因此它可能直接改写原有地址空间。

### mmap_region 可能新建 VMA，也可能合并邻居

选定地址后，`mmap_region()` 先处理地址空间与 overcommit 记账，再检查相邻 VMA 是否兼容：

- 权限、文件、页偏移、匿名映射关系、内存策略等都兼容时，新范围可以扩展已有 VMA；
- 前后两侧都兼容时，甚至可能把三段合成一段；
- 无法合并时，才分配新的 `vm_area_struct`，填写 `vm_start`、`vm_end`、`vm_flags`、`vm_page_prot`、`vm_pgoff` 和后备对象，并存入 `mm->mm_mt`；
- 文件映射还要加入文件地址空间的 `i_mmap` 区间树，匿名私有映射则标记为匿名 VMA。

因此，**一次 `mmap()` 不等于新增一个 VMA**。`mm->map_count` 统计当前 VMA 对象数量，而不是历史系统调用次数。

建立或扩展成功后，`vm_stat_account()` 增加 `mm->total_vm`，并按映射属性更新 `data_vm`、`exec_vm` 或 `stack_vm`。如果映射需要 overcommit 承诺，`VM_ACCOUNT` 与承诺量也会变化。这些都是地址空间或承诺记账，不是 RSS。

### 为什么 mmap 返回后通常还没有物理页

对普通、未要求预填充的私有匿名映射，`mmap_region()` 建立的是“以后访问这段地址时应该怎样处理”的规则。此时通常没有为整个范围建立 PTE，也没有逐页分配私有物理内存。

存在几类重要例外：

- `MAP_POPULATE` 可以让返回后的 `mm_populate()` 主动触发预取或缺页处理；
- `MAP_LOCKED` 会配合锁页语义尝试建立并驻留页面；
- HugeTLB 映射有自己的预留和页表路径；
- 设备或驱动的 mmap 回调可能直接安装 PFN、特殊 PTE 或建立其他外部资源关系；
- 文件系统与 DAX 等映射可能采用不同的后备和缺页实现。

所以准确说法是“普通匿名 mmap 通常只登记 VMA”，而不是“mmap 永远不会建立页表”。

## 3. 第一次读取：可能只得到共享零页

CPU 第一次访问尚无有效页表项的地址时触发异常。体系结构入口找到对应 VMA、检查访问类型后，进入 `handle_mm_fault()`；普通匿名映射最终可走到 `mm/memory.c:do_anonymous_page()`。

对于允许使用零页的只读缺页，Linux 6.6 会构造一个指向体系结构共享零页的只读特殊 PTE：

```text
VMA：允许读写的私有匿名区间
PTE：当前只读，指向共享零页
物理数据：所有字节为 0，由多个地址共享
```

这不矛盾。VMA 表达区域允许的上层语义；PTE 表达这个虚拟页当前的硬件映射和权限。区域最终允许写，不代表第一次读取时就必须分配一张私有可写页。

因此，逐页读取一段新匿名映射，不能简单预测为“RSS 按读取字节数增加”。共享零页、THP、体系结构行为和统计口径都可能改变观察结果。

## 4. 第一次写入：私有页、PTE、rmap 和 RSS 一起出现

第一次直接写入未建立的匿名页，或者写入先前指向共享零页的地址，需要获得私有可写后备。Linux 6.6 的匿名缺页路径会完成几件相互关联的事：

1. 必要时用 `anon_vma_prepare()` 建立匿名反向映射关系；
2. 用 `vma_alloc_zeroed_movable_folio()` 分配清零的匿名 folio；
3. 执行 memcg 记账，并把 folio 标为 uptodate；
4. 构造符合 `vm_page_prot` 的 PTE，写缺页时设置写和脏状态；
5. 在页表锁保护下重新确认 PTE 没被并发修改；
6. 增加 `MM_ANONPAGES`，建立匿名 rmap，把 folio 加入 LRU；
7. 安装 PTE，并更新体系结构 MMU 缓存状态。

这时“地址合法”“页表可翻译”“物理页属于该映射”“RSS 计入匿名页”才同时成立。

文件映射的页级路径不同：缺页处理通常从页缓存取得 folio，私有可写映射还可能在写入时发生 COW，共享可写映射则涉及脏页和回写语义。但 VMA 先描述规则、访问再解析到页级后备这一分层仍然成立。

## 5. munmap 可以只切掉一个 VMA 的中间部分

`munmap(addr, len)` 要求起始地址按页对齐；长度会向页边界对齐。Linux 对范围中的空洞是宽容的：只要参数合法，即使没有找到重叠 VMA，也可以成功返回。

上游 6.6 的入口为：

```text
munmap 系统调用
  → __vm_munmap()
      ├─ mmap_write_lock_killable(mm)
      └─ do_vmi_munmap()
           └─ do_vmi_align_munmap()
```

真正复杂的情况不是删除完整 VMA，而是解除其中一段。例如原 VMA 为：

```text
[A, D)
```

调用：

```text
munmap(B, C - B)     其中 A < B < C < D
```

结果不是把整个 VMA 删除，而是：

```text
[A, B)       空洞 [B, C)       [C, D)
 左侧 VMA                       右侧 VMA
```

`do_vmi_align_munmap()` 会在 `B` 和 `C` 处调用 `__split_vma()`。一个原始 VMA 会暂时变成三段，目标中段随后被移除，最终留下两个 VMA。于是部分 `munmap()` 之后，`map_count` 甚至可能比调用前多一个；“释放地址空间必然减少 VMA 数量”并不成立。

拆分还需要复制 VMA 元数据、策略、文件引用和匿名反向映射关系，并执行相关 `vm_ops` 回调。某些特殊 VMA 可以通过 `may_split` 拒绝不支持的拆分。

## 6. munmap 不是简单 free：它按顺序撤销四层关系

### 第一步：把目标 VMA 从地址空间拓扑摘除

边界准备好后，6.6 会把所有重叠 VMA 收集到临时 Maple Tree，并从 `mm->mm_mt` 清除目标范围。随后更新 `map_count`、`locked_vm` 等状态。

这一顺序很重要：目标 VMA 与剩余地址空间先被隔离，后续清理页表时不再把它当成正常可查找映射。实现还可以在安全条件下把 `mmap_lock` 从写锁降为读锁，让耗时的页级清理减少对其他地址空间读取者的阻塞。

### 第二步：通知依赖同一地址空间的外部组件

`unmap_vmas()` 用 `MMU_NOTIFY_UNMAP` 包围页表撤销。KVM、HMM 和其他通过 MMU notifier 跟踪进程页表的组件，可以在 CPU 页表失效前后同步自己的二级映射或设备状态。

userfaultfd、uprobes、文件反向映射和特殊 PFN 映射也有各自的通知或撤销步骤。它们说明“解除一个用户虚拟地址”可能影响的不只是进程自己的页表。

### 第三步：逐级清页表并更新页级记账

普通页表路径最终进入 `unmap_page_range()` 和 `zap_pte_range()` 一类函数。对 present PTE，内核会：

- 原子清除页表项并把失效项加入 TLB gather；
- 对文件页传播脏状态，必要时记录访问状态；
- 减少相应 RSS 计数；
- 删除 rmap，降低映射计数和页引用；
- 批量排队等待后续安全释放。

swap entry、迁移项、device-private entry、userfaultfd marker 和 hugetlb 映射各有不同分支，不能都按普通 present PTE 理解。

页表页本身也不一定全部释放。`free_pgtables()` 只会在相应页表范围不再被邻近 VMA 使用、且满足体系结构边界等条件时回收页表层级。解除几个页面，可能只是清掉 PTE，仍保留承载其他地址的页表页。

### 第四步：完成 TLB 失效后再释放可复用对象

CPU 可能已经把旧 PTE 缓存在 TLB 中。仅把内存里的页表项清零还不够，否则另一个 CPU 仍可能短暂使用旧翻译访问已经被重新分配的物理页。

`unmap_region()` 使用 `mmu_gather`：`tlb_gather_mmu()` 开始收集，页表遍历批量登记要失效的翻译和待释放页面，`tlb_finish_mmu()` 完成必要的 TLB 刷新并安全释放批次。具体是本地失效还是跨 CPU shootdown，由体系结构和该 `mm` 的运行情况决定。

因此，`munmap()` 返回后可以依赖的是：**该进程原目标范围不再具有旧映射，相关 CPU 不应继续使用旧 TLB 翻译。** 不能依赖的是“原物理页一定已经回到 Buddy”：

- 私有匿名页没有其他引用时才可释放；
- fork 后共享的 COW 页可能仍被另一个进程映射；
- 文件页通常仍可留在 Page Cache；
- 被 pin、设备引用或处于特殊迁移状态的页还有自己的生命期。

最后，`remove_mt()` 递减虚拟内存与 overcommit 记账，执行 VMA `close` 回调、释放文件与 NUMA 策略引用，并释放 `vm_area_struct`。

## 7. 多线程为什么最容易踩到 munmap 的边界

同一进程的线程通常共享一个 `mm_struct`。一个线程执行 `munmap()`，其他线程看到的也是同一棵 VMA Maple Tree 和同一套页表。

`mmap_lock` 保护 VMA 拓扑修改，页表锁保护更细粒度的页表状态，MMU notifier 和 TLB shootdown 再处理外部观察者与 CPU 缓存。但这些锁只保证内核数据结构一致，**不会替用户程序保证指针仍然有效**。

如果线程 A 解除映射，而线程 B 没有协议地继续解引用旧指针，B 之后可能：

- 因找不到合法 VMA 而收到 `SIGSEGV`；
- 在区间被重新映射后访问到完全不同的对象；
- 与 A 在调用前后形成用户态 use-after-unmap 竞态。

所以“`munmap()` 已同步 TLB”不等于“其他线程可以安全继续使用旧地址”。前者是内核翻译一致性，后者需要用户态生命期协议。

## 8. 6.6.y 修复了哪些与生命周期相关的问题

从 `v6.6` 初始实现到 6.6.y，基础生命期没有改变，但 VMA 合并和 `mmap_region()` 错误回滚得到重要修复。

| 修复 | 首次上游提交 | 进入 6.6.y | 影响 |
| --- | --- | --- | --- |
| 修复 `vma_merge()` case 7 未调用 `vm_ops->close` | `fc0c8f9089c2` | 6.6.24 | 避免 SysV shmem 等 VMA 合并时泄漏资源或计数 |
| 让错误路径上的 VMA close 幂等 | `4080ef1579b2` | 6.6.63 | 降低重复或遗漏执行 `close` 回调的风险 |
| 重构 `mmap_region()` 错误路径 | `5de195060b2e` | 6.6.63 | 把可能失败的检查前移，避免部分初始化状态、资源泄漏和不一致回滚 |

openEuler `OLK-6.6` 已包含这些稳定回合，对应本地提交分别为 `e484a44213b8`、`8dcf757d012d` 和 `4b5e708273e2`。这类补丁主要强化失败路径和 VMA 回调生命期，不改变成功的普通匿名映射仍然遵循“VMA → 按需页表 → munmap 撤销”的主线。

## 9. openEuler 在普通路径之外增加了什么

当前 openEuler 基线对普通 `mmap`/`munmap` 路径做了大量上游回合，但还能看到两个发行版扩展方向。

### 为指定 mm 建立映射

提交 `4f4042f1e777`（`mm: Extend mmap assocated functions to accept mm_struct`）增加 `__do_mmap_mm()` 等接口，把原来隐含使用 `current->mm` 的部分路径改为可接收显式 `mm_struct`。提交说明表明它服务于 Ascend share pool，需要为其他进程的地址空间建立映射。

普通用户态 `mmap()` 仍然通过当前进程的 `mm`，所以这一扩展改变的是内核内部可服务的对象范围，不是普通应用观察到的基本生命期。

### MAP_PEER_SHARED

提交 `4a046852c066` 增加 `MAP_PEER_SHARED`，用于 peer-shared memory。它要求映射大小按 hugepage 单位，并把这类 VMA 标为不可迁移；映射和解除映射还要联动 GMEM 相关状态。

这属于 openEuler 特殊后备类型。写普通匿名映射文章时不能把它画成每次 `mmap()` 都会经过的步骤，但研究 openEuler 设备共享内存时必须单独追踪它的 VMA 标志、页表和跨设备引用生命期。

## 10. Linux 6.7 到 7.2：语义主线没变，内部事务边界更清楚

后续上游并没有推翻本文的心智模型，但实现位置、并发范围和文件 mmap 接口持续演进。

| 首次版本 | 代表变化 | 阅读当前源码时的意义 |
| --- | --- | --- |
| 6.7 | `164b06f238b9` 到 `4a68fef16df9` 扩大 per-VMA lock 下可处理的写保护、共享、COW、读和只读写缺页范围 | 更多缺页可以避免退回全局 `mmap_lock`，生命周期语义不变，并发粒度更细 |
| 6.12 | `49b1b8d6f683` 把核心 VMA 操作移到独立文件；`dba14840905f` 引入 `vma_munmap_struct` | munmap 的收集、拆分、摘除、完成和回滚开始用显式状态对象组织 |
| 6.13 | `52956b0d7fb9` 把 mmap 内部逻辑移到 `mm/vma.c` | 不能再只盯着 `mm/mmap.c` 阅读 VMA 建立过程 |
| 6.16 | `c84bf6dd2b83` 引入受限的文件操作 `mmap_prepare()` 回调 | 文件或驱动在真正合并、插入 VMA 前声明允许修改的字段，错误回滚更容易推理 |
| 6.19 | `9ea35a25d51b` 引入 `vma_flags_t` 位图类型 | 为更多 VMA 标志扩展空间，提交本身声明无功能变化 |
| 7.0 | `5b6626a76a81` 引入 `unmap_desc` | 把解除映射的大量参数收拢为描述符，提交本身声明无功能变化 |

到 Linux 7.2，系统调用入口仍可在 `mm/mmap.c` 看到，但 `do_vmi_munmap()`、`mmap_region()` 和大量 VMA 事务逻辑已位于 `mm/vma.c`；文件映射还围绕 `vm_area_desc`、`mmap_action` 和 `mmap_prepare()` 组织准备与完成阶段。

这意味着阅读新内核时，函数名和文件位置会变化，但判断状态的办法没有变：先问目标范围何时进入或离开 VMA 树，再问页表何时建立或清除，最后问后备页、引用、统计和 TLB 何时收尾。

## 11. 用一个三页映射观察全过程

下面的程序不制造内存压力，只建立三页匿名映射，分阶段读取、写入和解除中间一页：

```c
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <unistd.h>

static void pause_at(const char *stage)
{
    printf("pid=%ld stage=%s\n", (long)getpid(), stage);
    fflush(stdout);
    getchar();
}

int main(void)
{
    long page = sysconf(_SC_PAGESIZE);
    size_t len = 3 * (size_t)page;
    unsigned char *p;
    volatile unsigned char sink;

    p = mmap(NULL, len, PROT_READ | PROT_WRITE,
             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) {
        perror("mmap");
        return 1;
    }

    printf("mapping=%p page_size=%ld\n", (void *)p, page);
    pause_at("after mmap");

    sink = p[0];
    (void)sink;
    pause_at("after first read");

    p[page] = 1;
    pause_at("after first write");

    if (munmap(p + page, page) == -1) {
        perror("partial munmap");
        return 1;
    }
    pause_at("after middle-page munmap");

    if (munmap(p, page) == -1 || munmap(p + 2 * page, page) == -1) {
        perror("final munmap");
        return 1;
    }
    pause_at("after final munmap");
    return 0;
}
```

先记录运行内核与体系结构，避免把运行系统误当成本文源码树：

```bash
uname -r
uname -m
getconf PAGESIZE
```

编译并跟踪系统调用：

```bash
cc -O0 -Wall -o mmap-life mmap-life.c
strace -e trace=mmap,munmap,mprotect,brk ./mmap-life
```

程序每次暂停时，在另一终端根据它打印的 PID 和地址观察：

```bash
cat /proc/<pid>/maps
cat /proc/<pid>/status | rg '^(VmSize|VmRSS|RssAnon|RssFile|VmPTE):'
cat /proc/<pid>/stat
```

如需定位到具体区间，可查看 `/proc/<pid>/smaps` 中覆盖打印地址的条目。预期关系是：

- `mmap` 后地址区间出现，但 RSS 不必同步增加三页；
- 第一次读取可能只建立零页映射；
- 写入第二页后匿名驻留通常增加；
- 解除中间页后，`maps` 中目标地址成为空洞，左右部分仍有效；
- 最后两次 `munmap` 后整个三页范围消失。

具体地址、VMA 是否与邻居合并、RSS 的精确增量、THP 是否参与，以及 `/proc` 两次读取间的并发变化，都由运行内核、体系结构、配置和进程状态决定。本文没有伪造一组固定输出。

{% note warning no-icon %}
**不要在 partial munmap 后再读取中间页**

中间页已经不再属于原映射。故意访问它通常会触发 `SIGSEGV`，而且在多线程程序中还可能与地址复用形成更隐蔽的竞态。若要观察故障行为，应放进一次性测试进程，不要在承载真实工作的进程中尝试。
{% endnote %}

## 12. 回到最初的问题

从建立映射到 `munmap()`，地址空间经历的不是一次简单分配和释放，而是一组分层状态转换：

1. `mmap()` 选择地址并登记 VMA 规则，更新虚拟内存与承诺记账；
2. 普通匿名映射通常在成功返回时还没有逐页建立 PTE 或私有物理页；
3. 首次读取可以映射共享零页，首次写入才通常分配私有匿名页并建立 rmap、LRU、RSS 和可写 PTE；
4. `munmap()` 若切中 VMA 内部，先拆分边界，再把目标 VMA 从 Maple Tree 摘除；
5. 内核随后清页表、RSS、rmap 和引用，经 MMU notifier 协调外部映射，用 `mmu_gather` 完成 TLB 失效和安全释放；
6. 目标虚拟区间在返回后成为空洞，但物理页是否真正释放仍取决于页缓存、共享映射、pin 和其他引用。

抓住这六步，就能解释为什么 `VmSize` 与 RSS 不同步、为什么读零页与写私页不同、为什么部分 `munmap()` 可能增加 VMA 数量，以及为什么 TLB 刷新完成也不代表所有底层物理对象立即消失。

## 参考与源码索引

- 上游 Linux `v6.6`：`mm/mmap.c` 的 `do_mmap()`、`mmap_region()`、`do_vmi_munmap()`、`do_vmi_align_munmap()`、`unmap_region()` 与 `vm_stat_account()`。
- 上游 Linux `v6.6`：`mm/memory.c` 的 `do_anonymous_page()`、`handle_mm_fault()`、`unmap_vmas()`、`unmap_page_range()` 与 `zap_pte_range()`。
- 上游 Linux `v6.6`：`include/linux/mm_types.h` 的 `mm_struct`、`vm_area_struct` 与 VMA iterator。
- [Linux 6.6 Memory Management APIs](https://docs.kernel.org/6.6/core-api/mm-api.html) 与 [页表文档](https://docs.kernel.org/6.6/mm/page_tables.html)。
- [kernel.org 版本列表](https://www.kernel.org/)：本文写作时的 stable、longterm 与 mainline 检查终点。
- [上游提交 `fc0c8f9089c2`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=fc0c8f9089c20d198d8fe51ddc28bfa1af588dce)：修复 VMA 合并时的 close 回调处理。
- [上游提交 `5de195060b2e`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=5de195060b2e251a835f622759550e6202167641)：重构 `mmap_region()` 错误路径。
- [上游提交 `dba14840905f`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=dba14840905f9ecaad0b3a261e4d7a88120c8c7a)：引入 `vma_munmap_struct`。
- [上游提交 `52956b0d7fb9`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=52956b0d7fb92e3b39513dda91951ca419afc63a)：把 mmap 内部逻辑移入 `mm/vma.c`。
- [上游提交 `c84bf6dd2b83`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=c84bf6dd2b836b49bb2662668ff1692350d28236)：引入文件 `mmap_prepare()` 回调。
- openEuler `OLK-6.6`：`mm/mmap.c`、`mm/memory.c`、`include/linux/mm.h`，以及本地提交 `4f4042f1e777`、`4a046852c066`。
- 前置阅读：[mm_struct 和 VMA 如何描述一个进程的地址空间？](/posts/linux-mm-struct-and-vma/) 与 [malloc、brk 与 mmap 是什么关系？](/posts/linux-malloc-brk-mmap/)。
