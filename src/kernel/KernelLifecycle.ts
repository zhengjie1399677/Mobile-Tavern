import type { IKernel } from "./types";

export type KernelLifecycleState = "idle" | "initializing" | "ready" | "destroying";

export interface KernelLifecycleController {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  getState(): KernelLifecycleState;
}

/**
 * 串行化内核的启动与销毁请求。
 *
 * React StrictMode 会在开发环境中立即执行一次 effect 清理再重新挂载。
 * 这里以最新的目标状态为准，使“启动 → 销毁 → 启动”收敛为一次有效启动，
 * 避免旧清理任务在新挂载完成后销毁正在使用的内核。
 */
export function createKernelLifecycleController(
  kernel: Pick<IKernel, "destroy">,
  bootstrap: () => Promise<void>,
): KernelLifecycleController {
  let state: KernelLifecycleState = "idle";
  let shouldBeRunning = false;
  let queue = Promise.resolve();

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const scheduled = queue.then(operation, operation);
    // 保持后续请求可执行，同时仍将本次错误返回给调用方。
    queue = scheduled.catch(() => undefined);
    return scheduled;
  };

  return {
    initialize(): Promise<void> {
      shouldBeRunning = true;
      return enqueue(async () => {
        if (state === "ready") return;

        state = "initializing";
        try {
          await bootstrap();
          state = "ready";
        } catch (error) {
          state = "idle";
          // 兜底全量清理：防止 bootstrap 部分成功后残留半初始化状态。
          // registerServiceBatch 内部已对批量注册中途失败做逆序回滚，
          // 此处覆盖 bootstrap 中其他步骤（如 registerDefaultPipelines）
          // 或未来新增 bootstrap 阶段失败时的清理需求。
          // 清理后 services/pipelines/criticalServiceNames 等全部清空，
          // 亦化解了 "destroy() 被 idle 短路跳过" 的二级缺陷。
          try {
            await kernel.destroy();
          } catch (cleanupErr) {
            console.error("[KernelLifecycle] Cleanup after bootstrap failure failed:", cleanupErr);
          }
          throw error;
        }
      });
    },

    destroy(): Promise<void> {
      shouldBeRunning = false;
      return enqueue(async () => {
        // 允许紧随其后的重新启动撤销过时的销毁请求。
        if (shouldBeRunning || state === "idle") return;

        state = "destroying";
        try {
          await kernel.destroy();
        } finally {
          state = "idle";
        }
      });
    },

    getState(): KernelLifecycleState {
      return state;
    },
  };
}
