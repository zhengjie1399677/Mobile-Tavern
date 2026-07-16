# AI 协作物理隔离开发铁律与实操流程

> [!IMPORTANT]
> **此文件为 Mobile Tavern 行为指导手册的子规范，定义了新服务开发时的沙盒隔离、上下文控制及 TDD 流程。**

---

### 1. 沙盒隔离原则
AI 仅允许对新创建的或指定的单兵服务/插件文件（如 `src/kernel/services/QuotaCheckService.ts`）进行读写，严禁改动 `Kernel.ts` 底座或其他无关服务文件。

### 2. 双重锁框定输入范围
*   **框定最简上下文**：向 AI 提问时，仅向 AI 提供以下三个文件引用：
    1. `src/kernel/types.ts` —— 内核接口契约
    2. 新创建的空服务文件 —— 本次修改的唯一物理阵地
    3. `src/kernel/README.md` —— 内核开发约束指南
*   **边界 Prompt 模板**：向 AI 发出明确约束，限定其仅修改此单个物理文件。

### 3. TDD 单兵测试驱动
*   **局部跑通验证**：在 `tests/run_all_tests.ts` 中追加独立的单元测试。通过在命令行执行 `npm run lint` 和 `npm run test` 进行局部单兵验证，在这个隔离测试容器中修补逻辑直至其 100% 成功通过，最后才允许被装配注册至 `index.ts` 中上线。

### 4. 彻底解耦与生命周期资源回收
*   **按需声明拓扑依赖**：在类中声明 `readonly dependencies = [KernelServices.Database] as const`，利用拓扑 Kahn 排序进行服务批量自愈装配。
*   **AbortSignal 彻底回收**：在 `init(kernel, signal?)` and `destroy(kernel, signal?)` 中，必须将 `signal` 绑定到所有内部的 `fetch`、异步 Promise 或定时器中，确保在内核注销/销毁时资源能被 100% 回收释放，严禁残留挂起异步任务。
