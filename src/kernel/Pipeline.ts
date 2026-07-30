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

  list(): ReadonlyArray<{ name: string; priority: number }> {
    return this.middlewares.map((entry) => ({
      name: entry.fn.name || "(anonymous)",
      priority: entry.priority,
    }));
  }

  async execute(context: T): Promise<void> {
    const middlewares = [...this.middlewares];
    let index = -1;

    const dispatch = async (currentIndex: number): Promise<void> => {
      if (currentIndex <= index) {
        throw new Error("[Pipeline] next() called multiple times within the same middleware.");
      }
      index = currentIndex;
      if (currentIndex === middlewares.length) return;
      if ((context as { isInterrupted?: boolean }).isInterrupted === true) return;

      const middleware = middlewares[currentIndex];
      let nextCalled = false;
      const next = async (): Promise<void> => {
        nextCalled = true;
        await dispatch(currentIndex + 1);
      };
      const interrupt = () => {
        (context as { isInterrupted?: boolean }).isInterrupted = true;
      };

      try {
        await middleware.fn(context, next, interrupt);
        if (!nextCalled && (context as { isInterrupted?: boolean }).isInterrupted !== true) {
          if (this.isStrict()) {
            throw new Error(
              `[Pipeline DevError] Middleware "${middleware.fn.name || "anonymous"}" (index ${currentIndex}) ` +
              "finished execution without calling next() and without calling interrupt(). " +
              "This is a design logic violation. Use the third parameter interrupt() for intentional blocking.",
            );
          }
          this.logger.error(
            "Pipeline middleware finished without calling next() or interrupt(). Pipeline halted to preserve security boundary. This is a bug — fix the middleware.",
            undefined,
            { middleware: middleware.fn.name || "anonymous", index: currentIndex },
          );
        }
      } catch (error: unknown) {
        if (this.isStrict()) throw error;
        this.logger.error(
          "Pipeline middleware threw an exception. Pipeline halted.",
          error,
          { middleware: middleware.fn.name || "anonymous", index: currentIndex },
        );
      }
    };

    await dispatch(0);
  }
}
