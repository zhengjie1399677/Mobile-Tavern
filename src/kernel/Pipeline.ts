import type { IPipeline, Middleware } from "./types";

interface PipelineLogger {
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}

/**
 * Koa 风格的洋葱管道，支持优先级、显式阻断和严格模式语义校验。
 */
export class Pipeline<T> implements IPipeline<T> {
  private middlewares: Array<{ fn: Middleware<T>; priority: number }> = [];

  constructor(
    private readonly isStrict: () => boolean,
    private readonly logger: PipelineLogger,
  ) {}

  use(middleware: Middleware<T>, priority = 0): () => void {
    const entry = { fn: middleware, priority };
    this.middlewares.push(entry);
    this.middlewares.sort((left, right) => right.priority - left.priority);
    return () => {
      this.middlewares = this.middlewares.filter((candidate) => candidate !== entry);
    };
  }

  unuse(middleware: Middleware<T>): void {
    this.middlewares = this.middlewares.filter((entry) => entry.fn !== middleware);
  }

  matches(middlewares: readonly Middleware<T>[]): boolean {
    if (middlewares.length !== this.middlewares.length) return false;
    const remaining = [...this.middlewares];
    for (const middleware of middlewares) {
      const index = remaining.findIndex((entry) => entry.fn === middleware);
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return remaining.length === 0;
  }

  list(): ReadonlyArray<{ name: string; priority: number }> {
    return this.middlewares.map((entry) => ({
      name: entry.fn.name || "(anonymous)",
      priority: entry.priority,
    }));
  }

  async execute(context: T): Promise<void> {
    const middlewares = [...this.middlewares];
    let index = -1;
    let interrupted = false;
    const reportedErrors = new WeakSet<object>();

    const reportOnce = (
      error: unknown,
      message: string,
      middleware: Middleware<T>,
      middlewareIndex: number,
    ): void => {
      if ((typeof error === "object" && error !== null) || typeof error === "function") {
        if (reportedErrors.has(error)) return;
        reportedErrors.add(error);
      }
      this.logger.error(message, error, {
        middleware: middleware.name || "anonymous",
        index: middlewareIndex,
      });
    };

    const dispatch = async (currentIndex: number): Promise<void> => {
      if (currentIndex <= index) {
        throw new Error("[Pipeline] next() called multiple times within the same middleware.");
      }
      index = currentIndex;
      if (currentIndex === middlewares.length) return;
      if (interrupted) return;

      const middleware = middlewares[currentIndex];
      let nextCalled = false;
      let nextPromise: Promise<void> | undefined;
      const next = async (): Promise<void> => {
        nextCalled = true;
        nextPromise = dispatch(currentIndex + 1);
        // 即使中间件忘记 await next()，也立即登记 rejection handler，
        // 并在当前中间件返回后由调度器统一等待和传播失败。
        void nextPromise.catch(() => undefined);
        await nextPromise;
      };
      const interrupt = () => {
        interrupted = true;
        // isInterrupted 仅作为可观测输出；执行控制只信任本次 execute 的局部状态，
        // 防止调用方预置字段或复用旧 context 绕过中间件链。
        if ((typeof context === "object" && context !== null) || typeof context === "function") {
          try {
            (context as { isInterrupted?: boolean }).isInterrupted = true;
          } catch {
            // 冻结 context 仍可正常中断，反射字段写入失败不改变控制语义。
          }
        }
      };

      try {
        await middleware.fn(context, next, interrupt);
        if (nextPromise) {
          await nextPromise;
        }
        if (!nextCalled && !interrupted) {
          const error = new Error(
            `[Pipeline DevError] Middleware "${middleware.fn.name || "anonymous"}" (index ${currentIndex}) ` +
            "finished execution without calling next() and without calling interrupt(). " +
            "This is a design logic violation. Use the third parameter interrupt() for intentional blocking.",
          );
          if (!this.isStrict()) reportOnce(
            error,
            "Pipeline middleware finished without calling next() or interrupt(). Pipeline halted to preserve security boundary. This is a bug — fix the middleware.",
            middleware.fn,
            currentIndex,
          );
          throw error;
        }
      } catch (error: unknown) {
        if (this.isStrict()) throw error;
        reportOnce(
          error,
          "Pipeline middleware threw an exception. Pipeline halted.",
          middleware.fn,
          currentIndex,
        );
        // 生产环境仍需把失败传播给事务调用方；记录日志不等于成功执行。
        throw error;
      }
    };

    await dispatch(0);
  }
}
