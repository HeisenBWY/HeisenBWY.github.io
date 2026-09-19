---
title: OS
description: 从内存管理出发，通过原理、源码与实验，逐步理解 Linux 内核。
os_hub: true
topics:
  - id: memory
    title: 内存管理
    tag: 内存管理
    focus: true
    question: 程序使用的内存从哪里来，不够用时怎么办？
    scope: 地址空间 · 页表与缺页 · Buddy 与 SLUB · Page Cache · 回收与 OOM · NUMA
  - id: foundations
    title: 内核基础与实验环境
    tag: 内核基础
    question: 如何进入内核的世界，并搭建可重复的实验环境？
    scope: 用户态与内核态 · 系统调用 · 内核编译 · QEMU · 源码阅读与调试
  - id: scheduling
    title: 进程与调度
    tag: 进程调度
    question: 程序如何成为进程，CPU 又决定先运行谁？
    scope: 进程与线程 · 创建与退出 · 上下文切换 · 调度策略 · 负载均衡
  - id: concurrency
    title: 并发与同步
    tag: 并发同步
    question: 多个执行流同时访问数据，如何保证正确性？
    scope: 原子操作 · 锁 · 等待与唤醒 · RCU · 内存屏障
  - id: filesystems
    title: 文件系统与存储
    tag: 文件系统
    question: 从读写一个文件，到数据落盘，中间发生了什么？
    scope: VFS · inode 与 dentry · 文件系统 · 块层 · I/O 与持久化
  - id: devices
    title: 中断与设备驱动
    tag: 中断与驱动
    question: 内核如何响应硬件事件，与设备交换数据？
    scope: 异常与中断 · 软中断 · 工作队列 · 设备模型 · DMA
  - id: networking
    title: 网络子系统
    tag: 网络子系统
    question: 一个数据包如何从网卡到达应用程序？
    scope: Socket · 协议栈 · 收发包路径 · 队列 · 网络性能
  - id: isolation
    title: 资源隔离与控制
    tag: 资源隔离
    question: 多组程序如何共享系统，又各自受到资源约束？
    scope: namespace · cgroup · 容器隔离 · 资源限制与观测
---
从一个问题出发，理解机制，沿源码找到实现，再用实验验证。这里按专题整理 Linux 内核的学习过程，当前从内存管理开始。
