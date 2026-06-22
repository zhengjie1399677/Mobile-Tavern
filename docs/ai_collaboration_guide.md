# 🤖 AI 协作物理隔离开发实操小抄 (AI Collaboration Cheat Sheet)

本指南旨在规范在微内核架构下，如何通过**物理隔离**和**双重锁边界**，高效引导 AI 助理进行单兵服务开发，杜绝全盘扫描和不必要的代码污染。

---

## 🚀 隔离协作四步流 (The 4-Step Flow)

### 📌 第一步：物理建档 (隔离战场)
在项目特定目录下手动创建一个**全新、干净**的 TypeScript 文件。例如：
`src/kernel/services/QuotaCheckService.ts`

### 📌 第二步：双重锁指令 (框定范围)
在向 AI 提问时，通过 IDE 的 `@` 引用或手动声明，**仅向 AI 喂入以下三个文件**，杜绝庞大宿主上下文：
1.  **[types.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/types.ts)** —— 内核接口契约
2.  **新创建的空服务文件** —— 本次开发的唯一物理阵地
3.  **[src/kernel/README.md](file:///e:/modules/projects/Mobile-Tavern/src/kernel/README.md)** —— 内核开发铁律指南

> 💡 **复制以下 Prompt 格式发送给 AI**：
> ```text
> 任务：请基于 types.ts 契约，在 QuotaCheckService.ts 中实现 XXX 功能。
> 
> 🚨【边界约束铁律】
> 1. 你只拥有对 QuotaCheckService.ts 的修改权限，禁止阅读和修改 Kernel.ts 及其他任何无关文件。
> 2. 必须实现 IKernelService 接口，并使用 types.ts 中的规范定义。
> 3. 初始化或异步操作必须支持可选的 AbortSignal 参数，严禁产生“僵尸”挂起任务。
> ```

### 📌 第三步：TDD 测试驱动 (单兵校验)
让 AI 在 **[tests/run_all_tests.ts](file:///e:/modules/projects/Mobile-Tavern/tests/run_all_tests.ts)** 中追加独立的单元测试，并使用以下命令进行局部快速测试：
*   **编译类型检查**：`npm run lint` (`tsc --noEmit`)
*   **运行单元测试**：`npm run test`
AI 应在此局部沙盒中自行修复逻辑，直至该单兵测试 100% 通过。

### 📌 第四步：冷启动装配 (合并上线)
当单兵测试通过后，向 AI 提供最后一个文件 **[index.ts](file:///e:/modules/projects/Mobile-Tavern/src/kernel/index.ts)**，发出装配指令：
> “新服务已通过测试，请在 `initializeKernel` 批量注册数组中追加注册此服务。”

---

## 🎯 核心防崩设计法则 (AI 必须遵守的内核约束)
在编写新服务/插件时，AI 必须严格实现以下接口设计：
*   **按需声明依赖**：如果需要调用其他服务，在类中声明 `readonly dependencies = [KernelServices.Database] as const;`，内核会自动处理 Kahn 排序。
*   **AbortSignal 绑定**：在 `init(kernel, signal?)` 和 `destroy(kernel, signal?)` 中，必须将 `signal` 绑定到所有内部的 `fetch`、`Promise` 或定时器中，确保资源能在内核销毁时瞬间回收。
