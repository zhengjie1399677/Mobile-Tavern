import { IKernel, IKernelService, IPipeline, Middleware, IExtension } from "./types";

let strictMode = true;

export const setKernelStrictMode = (val: boolean) => {
  strictMode = val;
};

const isDev = (): boolean => {
  try {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
      return false;
    }
    // @ts-ignore
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.PROD) {
      return false;
    }
  } catch (e) {}
  return true; // 默认开发模式
};

const getKernelStrictMode = (): boolean => {
  return strictMode && isDev();
};

/**
 * Hook 单次执行超时阈值（毫秒）。
 * 防止劣质插件的异步死锁或网络挂起拖垮基座主业务流程。
 * triggerHook 和 triggerHookParallel 均对每个 Hook 独立计时，
 * 超时后记录警告并继续执行其他 Hook，不会阻断整个事件链。
 */
const HOOK_TIMEOUT_MS = 5000;

const createSafeProxy = (name: string, path = ""): any => {
  const noop = (..._args: any[]) => {
    return createSafeProxy(name, path + "()");
  };

  return new Proxy(noop, {
    get(_target, prop) {
      // ─── 条目 3 修复：Symbol 属性短路 ─────────────────────────────────────
      // console.log / util.inspect / 深拷贝库等工具会探测 Symbol.toStringTag、
      // Symbol.iterator 等内置 Symbol 属性。若不拦截，会绕过 typeof === "string"
      // 检查并继续返回新 SafeProxy，引发无限递归导致调用栈溢出。
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") {
        // 让 Promise await 链可以正常 resolve 结束，防止 SafeProxy 在 await 时永久挂起
        return (resolve: any) => resolve(undefined);
      }
      if (prop === "name") return name;
      if (prop === "init") return () => {};

      if (typeof prop === "string" && prop !== "then" && prop !== "name" && prop !== "init") {
        if (getKernelStrictMode()) {
          throw new Error(
            `[Kernel DevError] Service "${name}" is not registered or failed to initialize. ` +
            `Denying property access "${prop}" on SafeProxy in development mode.`
          );
        } else if (isDev()) {
          console.warn(
            `[Kernel DevWarning] Accessing property "${prop}" on SafeProxy of service "${name}". ` +
            `Please ensure this service is correctly registered.`
          );
        }
      }

      return createSafeProxy(name, path + "." + String(prop));
    },
  });
};

// ─── Pipeline ────────────────────────────────────────────────────────────────

class Pipeline<T> implements IPipeline<T> {
  private middlewares: Array<{ fn: Middleware<T>; priority: number }> = [];

  use(middleware: Middleware<T>, priority = 0): () => void {
    const entry = { fn: middleware, priority };
    this.middlewares.push(entry);
    // 按优先级降序排列，高优先级中间件先执行
    this.middlewares.sort((a, b) => b.priority - a.priority);
    return () => {
      this.middlewares = this.middlewares.filter(m => m !== entry);
    };
  }

  unuse(middleware: Middleware<T>): void {
    this.middlewares = this.middlewares.filter(m => m.fn !== middleware);
  }

  /** C-2 修复：返回当前已注册的中间件快照，用于调试与运行时可观测性 */
  list(): ReadonlyArray<{ name: string; priority: number }> {
    return this.middlewares.map(m => ({
      name: m.fn.name || "(anonymous)",
      priority: m.priority,
    }));
  }

  async execute(context: T): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("[Pipeline] next() called multiple times within the same middleware.");
      }
      index = i;

      // 所有中间件执行完毕
      if (i === this.middlewares.length) return;

      // 显式受控阻断：尊重中间件的有意拦截语义
      if ((context as any).isInterrupted === true) return;

      const middleware = this.middlewares[i];
      let nextCalled = false;
      const nextWrapper = async (): Promise<void> => {
        nextCalled = true;
        await dispatch(i + 1);
      };

      const interruptWrapper = () => {
        (context as any).isInterrupted = true;
      };

      try {
        await middleware.fn(context, nextWrapper, interruptWrapper);

        // ─── B-3 修复核心 ──────────────────────────────────────────────────────
        // 旧逻辑：生产环境在中间件遗忘调用 next() 时，自动 dispatch 下一个中间件。
        // 风险：无法区分"有意阻断"（权限校验拒绝）和"意外遗忘"（Bug）。
        // 在有权限/安全拦截器的场景下，自动穿透会直接击穿安全边界。
        //
        // 新逻辑：三态严格语义。
        //   - 调用 next()           → 继续执行后续中间件（正常流转）
        //   - isInterrupted = true  → 有意阻断，管道在此终止（权限拒绝、内容过滤等）
        //   - 两者均未执行          → Bug，任何环境均记录错误，不主动穿透边界
        // ──────────────────────────────────────────────────────────────────────
        if (!nextCalled && (context as any).isInterrupted !== true) {
          if (getKernelStrictMode()) {
            throw new Error(
              `[Pipeline DevError] Middleware "${middleware.fn.name || "anonymous"}" (index ${i}) ` +
              `finished execution without calling next() and without calling interrupt(). ` +
              `This is a design logic violation. Use the third parameter interrupt() for intentional blocking.`
            );
          } else {
            // 生产环境：记录错误但绝不自动穿透。
            // 若该中间件是有意阻断，穿透将导致安全漏洞；若是遗忘，亦应被修复而非掩盖。
            console.error(
              `[Pipeline Error] Middleware "${middleware.fn.name || "anonymous"}" (index ${i}) ` +
              `finished without calling next() or interrupt(). ` +
              `Pipeline halted at this point to preserve security boundary integrity. ` +
              `This is a bug — fix the middleware.`
            );
          }
        }
      } catch (err: any) {
        if (getKernelStrictMode()) {
          // 开发环境直接抛出，不遮掩任何错误
          throw err;
        } else {
          // 生产环境：记录错误并终止管道，不自动跳过出错的中间件
          console.error(
            `[Pipeline Error] Middleware "${middleware.fn.name || "anonymous"}" (index ${i}) ` +
            `threw an exception. Pipeline halted. Error:`,
            err
          );
        }
      }
    };

    await dispatch(0);
  }
}

// ─── Kernel ──────────────────────────────────────────────────────────────────

export class Kernel implements IKernel {
  private services = new Map<string, IKernelService>();
  private extensions = new Map<string, IExtension[]>();

  /**
   * B-2 修复：记录所有声明了 isCritical=true 的服务名称。
   * 在 init() 之前即记录，保证即使服务初始化失败后 getService 也能识别其关键性。
   * 对关键服务的 getService 失败，在任何环境均抛出致命错误而非静默降级。
   */
  private criticalServiceNames = new Set<string>();
  private activeControllers = new Set<AbortController>();

  /** B-4 修复：Hook 条目携带 priority，注册时按优先级降序排列 */
  private hooks = new Map<string, Array<{ fn: (...args: any[]) => any; priority: number }>>();
  private pipelines = new Map<string, IPipeline<any>>();

  constructor() {
    this.registerPipeline("input");
    this.registerPipeline("output");
    this.registerPipeline("settings");
  }

  async registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<void> {
    if (this.services.has(name)) {
      console.warn(`[Kernel] Service "${name}" is already registered. Overwriting...`);
    }

    // B-2 修复：在 init() 之前就标记关键服务，确保即使初始化失败也能在 getService时保护
    if (service.isCritical) {
      this.criticalServiceNames.add(name);
    }

    const controller = new AbortController();
    this.activeControllers.add(controller);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let initPromise: Promise<void> = new Promise<void>(resolve => resolve(service.init(this, controller.signal) as any));

    if (initTimeoutMs && initTimeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(); // 真正的中止！触发 abort 信号以停止底层的 IndexedDB 或网络挂起
          reject(new Error(
            `[Kernel] Service "${name}" init() timed out after ${initTimeoutMs}ms. ` +
            `Check for unresolved IO operations (IndexedDB, network) in this service's init().`
          ));
        }, initTimeoutMs);
      });
      initPromise = Promise.race([initPromise, timeoutPromise]);
    }

    try {
      await initPromise;
      if (timeoutId) clearTimeout(timeoutId);
      this.services.set(name, service);
      console.log(`[Kernel] Service registered and initialized successfully: ${name}`);
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      controller.abort(); // 如果发生异常，也发出 abort 信号以中止挂起的任务
      console.error(`[Kernel] FAILED to initialize service "${name}":`, err);
      this.services.delete(name);
      const isTimeout = err.message && err.message.includes("timed out");
      if (service.isCritical || isTimeout) {
        throw new Error(`[Kernel] Fatal: ${isTimeout ? "Timeout" : "Critical"} service "${name}" failed to initialize: ${err.message || err}`);
      }
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  /**
   * B-1 修复：批量注册服务，自动进行拓扑排序以保证依赖关系的注册顺序。
   *
   * 解决的问题：随着服务/插件数量增长到 30-100 个，手工维护注册顺序极易出错且不可持续。
   * 各服务通过 `IKernelService.dependencies` 声明其所依赖的服务名称，
   * 本方法使用 Kahn 算法自动排序，并在检测到循环依赖时立即抛出明确错误。
   */
  async registerServiceBatch(
    entries: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>
  ): Promise<void> {
    const nameSet = new Set(entries.map(e => e.name));
    const inDegree = new Map<string, number>();
    // graph: dep → dependents（dep 必须先于 dependent 注册）
    const graph = new Map<string, string[]>();

    for (const { name } of entries) {
      inDegree.set(name, 0);
      graph.set(name, []);
    }

    for (const { name, service } of entries) {
      for (const dep of service.dependencies ?? []) {
        if (!nameSet.has(dep)) {
          // 依赖的服务已在 kernel 中注册，无需再排序
          if (!this.services.has(dep)) {
            console.warn(
              `[Kernel] Service "${name}" declares dependency "${dep}" which is neither ` +
              `in this batch nor already registered in the kernel.`
            );
          }
          continue;
        }
        graph.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    // Kahn 算法：从入度为 0 的节点开始 BFS
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }> = [];
    const entryMap = new Map(entries.map(e => [e.name, e]));

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(entryMap.get(current)!);
      for (const dependent of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    // 循环依赖检测：若拓扑排序结果数量少于输入，说明存在环
    if (sorted.length !== entries.length) {
      const cycleNodes = entries
        .map(e => e.name)
        .filter(n => !sorted.some(s => s.name === n));
      throw new Error(
        `[Kernel] Circular dependency detected in service batch. ` +
        `Involved services: [${cycleNodes.join(", ")}]. ` +
        `Please review their 'dependencies' declarations.`
      );
    }

    // 按拓扑序依次注册
    for (const { name, service, initTimeoutMs } of sorted) {
      await this.registerService(name, service, initTimeoutMs);
    }
  }

  getService<T extends IKernelService>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      // ─── B-2 修复：关键服务不允许静默降级 ────────────────────────────────
      // 对 isCritical=true 的服务，使用 SafeProxy 会导致错误在调用链下游出现，
      // 届时错误堆栈只有 "Cannot read properties of undefined"，完全失去溯源能力。
      // 关键服务缺失在任何环境均属于系统级故障，必须立即暴露。
      // ─────────────────────────────────────────────────────────────────────
      if (this.criticalServiceNames.has(name)) {
        throw new Error(
          `[Kernel] FATAL: Critical service "${name}" is not available. ` +
          `The application cannot continue safely. ` +
          `Ensure "${name}" is registered and successfully initialized before use.`
        );
      }
      console.warn(
        `[Kernel] Service "${name}" is not registered or failed to initialize. ` +
        `Returning safe no-op fallback proxy.`
      );
      return createSafeProxy(name) as unknown as T;
    }
    return service as T;
  }

  async destroyService(name: string): Promise<void> {
    const service = this.services.get(name);
    if (service) {
      if (service.destroy) {
        const controller = new AbortController();
        this.activeControllers.add(controller);
        const DESTROY_TIMEOUT_MS = 5000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const destroyPromise = new Promise<void>(resolve => resolve(service.destroy!(this, controller.signal) as any));
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort(); // 超时触发真正的 Abort 信号中止销毁时的挂起操作
            reject(new Error(`[Kernel] Service "${name}" destroy() timed out after ${DESTROY_TIMEOUT_MS}ms.`));
          }, DESTROY_TIMEOUT_MS);
        });

        try {
          await Promise.race([destroyPromise, timeoutPromise]);
          if (timeoutId) clearTimeout(timeoutId);
        } catch (err) {
          if (timeoutId) clearTimeout(timeoutId);
          controller.abort();
          console.error(`[Kernel] Error executing destroy on service "${name}":`, err);
        } finally {
          this.activeControllers.delete(controller);
        }
      }
      this.services.delete(name);
      console.log(`[Kernel] Service destroyed and removed: ${name}`);
    }
  }

  registerPipeline<T = any>(name: string): IPipeline<T> {
    if (this.pipelines.has(name)) {
      console.warn(`[Kernel] Pipeline "${name}" is already registered. Returning existing instance.`);
      return this.pipelines.get(name) as IPipeline<T>;
    }
    const pipeline = new Pipeline<T>();
    this.pipelines.set(name, pipeline);
    console.log(`[Kernel] Pipeline registered: ${name}`);
    return pipeline;
  }

  getPipeline<T = any>(name: string): IPipeline<T> {
    let pipeline = this.pipelines.get(name);
    if (!pipeline) {
      console.warn(`[Kernel] Pipeline "${name}" not found. Auto-registering a new pipeline.`);
      pipeline = this.registerPipeline<T>(name);
    }
    return pipeline as IPipeline<T>;
  }

  /**
   * B-4 修复：registerHook 增加 priority 参数。
   * 优先级越高（数值越大）越先执行，内核/系统级 Hook 可使用高优先级确保先于插件 Hook 运行。
   */
  registerHook(event: string, fn: (...args: any[]) => any, priority = 0): () => void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    const entry = { fn, priority };
    const handlers = this.hooks.get(event)!;
    handlers.push(entry);
    handlers.sort((a, b) => b.priority - a.priority);
    return () => {
      this.unregisterHook(event, fn);
    };
  }

  unregisterHook(event: string, fn: (...args: any[]) => any): void {
    const handlers = this.hooks.get(event);
    if (handlers) {
      const filtered = handlers.filter(h => h.fn !== fn);
      if (filtered.length === 0) {
        // 条目 4 修复：彻底移除空 key，防止长生命周期下 Map 键无限膨胀
        this.hooks.delete(event);
      } else {
        this.hooks.set(event, filtered);
      }
    }
  }

  /** 串行触发：按优先级顺序依次 await 执行，适用于有顺序依赖 of Hook */
  async triggerHook(event: string, ...args: any[]): Promise<void> {
    const handlers = this.hooks.get(event);
    if (!handlers) return;
    for (const { fn } of handlers) {
      const controller = new AbortController();
      this.activeControllers.add(controller);
      const signal = controller.signal;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => {
            controller.abort(); // 超时触发真正的 Abort 信号中止 Hook 内挂起的异步操作
            reject(new Error(`[Kernel] Hook on "${event}" timed out after ${HOOK_TIMEOUT_MS}ms. Check for hanging async operations in registered hooks.`));
          },
          HOOK_TIMEOUT_MS
        );
      });
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            try { resolve(fn(...args, signal) as any); } catch (e) { reject(e); }
          }),
          timeout,
        ]).finally(() => {
          if (timerId) clearTimeout(timerId);
        });
      } catch (err) {
        controller.abort(); // 确保异常时同样调用 abort 中止
        console.error(`[Kernel] Error executing hook "${event}":`, err);
      } finally {
        this.activeControllers.delete(controller);
      }
    }
  }

  /**
   * B-4 修复补充：并行触发，适用于独立无依赖的 Hook（遥测、日志、UI 刷新等）。
   * 消除串行执行在独立 Hook 场景下的不必要延迟。
   * 使用 Promise.allSettled 确保单个 Hook 异常不影响其他 Hook 执行。
   * 条目 5 修复：每个并发 Hook 独立包裹超时熔断，防止永久挂起的 Hook 使 allSettled 永不 resolve。
   */
  async triggerHookParallel(event: string, ...args: any[]): Promise<void> {
    const handlers = this.hooks.get(event);
    if (!handlers) return;
    const withTimeout = ({ fn }: { fn: (...a: any[]) => any }): Promise<void> => {
      const controller = new AbortController();
      this.activeControllers.add(controller);
      const signal = controller.signal;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => {
            controller.abort(); // 超时触发真正的 Abort 信号中止 Hook 内挂起的异步操作
            reject(new Error(`[Kernel] Hook on "${event}" timed out after ${HOOK_TIMEOUT_MS}ms.`));
          },
          HOOK_TIMEOUT_MS
        );
      });
      return Promise.race([
        new Promise<void>((resolve, reject) => {
          try { resolve(fn(...args, signal) as any); } catch (e) { reject(e); }
        }),
        timeout,
      ]).finally(() => {
        if (timerId) clearTimeout(timerId);
        this.activeControllers.delete(controller);
      }).catch((err) => {
        controller.abort();
        throw err;
      });
    };
    const results = await Promise.allSettled(handlers.map(withTimeout));
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[Kernel] Error executing parallel hook "${event}":`, result.reason);
      }
    }
  }

  registerExtension(extension: IExtension): void {
    const point = extension.targetPoint;
    if (!this.extensions.has(point)) {
      this.extensions.set(point, []);
    }
    const list = this.extensions.get(point)!;
    const filtered = list.filter(ext => ext.id !== extension.id);
    filtered.push(extension);
    filtered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.extensions.set(point, filtered);
  }

  getExtensions(point: string): IExtension[] {
    return this.extensions.get(point) ?? [];
  }

  async destroy(): Promise<void> {
    console.log("[Kernel] Destroying all core pipelines, hooks, and services...");
    // 强制关停所有当前活跃的异步任务控制器
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch (err) {
        console.error("[Kernel] Error aborting active controller during destroy:", err);
      }
    }
    this.activeControllers.clear();

    // 条目 2 修复：逆序销毁。
    // 注册顺序是「自底向上」（基础服务 Database 先注册，业务服务 AutoSummary 后注册），
    // 销毁必须「自顶向下」：先销毁上层业务服务，最后销毁底层基础服务。
    // 确保上层服务的 destroy() 钩子在执行时（如写入最终状态到 DB）仍能安全调用底层服务，
    // 而不会因底层服务已被移除而触发 FATAL 错误或拿到 SafeProxy。
    const serviceNames = Array.from(this.services.keys()).reverse();
    for (const name of serviceNames) {
      await this.destroyService(name);
    }
    this.services.clear();
    this.criticalServiceNames.clear();
    this.hooks.clear();
    this.pipelines.clear();
    this.extensions.clear();
    console.log("[Kernel] Kernel base destroyed successfully.");
  }
}

/**
 * 工厂函数：创建一个全新的、独立的 Kernel 实例。
 *
 * B-5 修复（轻量版）：提供可测试性入口。
 * 单元测试可为每个用例通过 createKernel() 创建干净的实例，避免全局状态在测试间互相污染。
 */
export function createKernel(): Kernel {
  return new Kernel();
}

export const globalKernel = new Kernel();
