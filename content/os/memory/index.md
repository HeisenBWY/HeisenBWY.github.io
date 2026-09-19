---
title: 内存管理
description: Linux 内存管理知识地图：从地址空间到物理页分配、回收与诊断，按问题逐步研究。
layout: topic-map
modules:
  - id: overview
    title: 基础概念与全景
    scope: 虚拟地址与物理地址、page 与 folio、内存管理各部分的关系。
    questions:
      - title: Linux 内存管理全景入门
        article: /posts/linux-memory-management-overview
      - title: page 与 folio 分别描述什么，为什么需要两种抽象？
        article: /posts/linux-page-and-folio
      - title: 虚拟内存、驻留内存与物理内存占用有什么区别？
        article: /posts/linux-virtual-resident-physical-memory
  - id: address-space
    title: 进程地址空间
    scope: mm_struct、VMA、堆与栈、brk、mmap、映射生命周期。
    questions:
      - title: mm_struct 和 VMA 如何描述一个进程的地址空间？
      - title: malloc、brk 与 mmap 是什么关系？
      - title: 从建立映射到 munmap，地址空间经历了哪些变化？
  - id: page-tables
    title: 页表与缺页处理
    scope: 多级页表、MMU、TLB、按需分配、共享零页、写时复制。
    questions:
      - title: CPU 如何通过页表和 TLB 把虚拟地址转换为物理地址？
      - title: 申请了 1 GiB 内存，为什么 RSS 没有立刻增加？
      - title: fork 之后，写时复制在什么条件下复制物理页？
  - id: physical-memory
    title: 物理内存组织与初始化
    scope: NUMA Node、Zone、物理内存模型、memblock、启动时初始化。
    questions:
      - title: Node、Zone 与物理页是什么关系？
      - title: 内核如何通过内存模型管理物理页的元数据？
      - title: 从 memblock 到 Buddy，启动时如何接管物理内存？
  - id: allocators
    title: 内存分配器
    scope: Buddy、每 CPU 页缓存、GFP 标志、SLUB、kmalloc、vmalloc。
    questions:
      - title: Buddy 如何拆分和合并，每 CPU 页缓存如何参与分配？
      - title: GFP 标志如何影响分配范围、等待与回收？
      - title: SLUB 如何复用小对象，kmalloc 与 vmalloc 如何选择？
  - id: page-cache
    title: 文件页缓存与写回
    scope: Page Cache、文件映射、预读、脏页、写回、与文件系统的关系。
    questions:
      - title: read 与文件 mmap 如何使用 Page Cache？
      - title: 预读如何工作，为什么第二次读文件可能更快？
      - title: 脏页何时写回，写入返回与数据持久化有什么区别？
  - id: reclaim
    title: 内存回收与 Swap
    scope: LRU、多代 LRU、kswapd、直接回收、反向映射、workingset、换入换出。
    questions:
      - title: kswapd 与直接回收分别在什么条件下工作？
      - title: LRU、多代 LRU 与 workingset 如何帮助选择回收对象？
      - title: 反向映射与 Swap 如何参与匿名页回收和再次访问？
  - id: compaction
    title: 碎片、迁移与大页
    scope: 内存碎片、compaction、页迁移、THP、HugeTLB、CMA。
    questions:
      - title: 还有空闲内存，为什么连续物理页分配会失败？
      - title: 页迁移和内存规整如何形成更大的空闲块？
      - title: THP、HugeTLB 与 CMA 分别解决什么问题？
  - id: numa
    title: NUMA 与内存放置
    scope: 本地与远端访问、内存分配策略、自动 NUMA 平衡。
    questions:
      - title: CPU 和内存的位置关系如何影响访问性能？
      - title: 内存策略如何决定页分配在哪个节点？
      - title: 自动 NUMA 平衡如何发现并调整内存访问位置？
  - id: limits
    title: 资源限制与 OOM
    scope: 内存水位、overcommit、memcg、全局与组内 OOM。
    questions:
      - title: 水位与 overcommit 分别约束哪个阶段的内存使用？
      - title: memcg 如何记账和限制一组进程的内存？
      - title: 全局 OOM 与组内 OOM 有什么区别，如何选择受害进程？
  - id: diagnostics
    title: 观测与问题诊断
    scope: /proc 指标、内存压力、分配失败、泄漏、回收延迟与分析工具。
    questions:
      - title: 如何联合解读 meminfo、smaps、buddyinfo 与 vmstat？
      - title: 如何区分内存泄漏、缓存增长与内存碎片？
      - title: 如何用 PSI、跟踪事件与性能工具定位回收延迟？
---

先建立地图，再逐项深入。这份目录按 11 个模块整理要研究的问题，已有文章会直接链接到正文，其余作为后续研究计划。模块划分会随学习继续调整。
