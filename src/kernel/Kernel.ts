import { IKernel, IKernelService, IPipeline, Middleware, IExtension, IMessage } from "./types";

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
 * 消息处理器单次执行超时阈值（毫秒）。
 * 防止劣质插件的异步死锁或网络挂起拖垮消息总线核心分发流程。
 * publish 和 publishParallel 均对每个订阅者处理器独立计时，
 * 超时后触发 abort 熔断以防挂起，不会阻断整个事件链。
 */
const MSG_TIMEOUT_MS = 5000;

const createSafeProxy = (name: string): any => {
  const noop = (..._args: any[]) => {
    return createSafeProxy(name);
  };

  return new Proxy(noop, {
    get(_target, prop) {
      // Symbol 属性短路保护：工具探测 Symbol 属性时拦截，避免无限递归导致调用栈溢出
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

      return createSafeProxy(name);
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
    // 快照当前中间件列表，防止执行期间 use()/unuse() 修改数组导致索引错位
    const middlewares = [...this.middlewares];
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("[Pipeline] next() called multiple times within the same middleware.");
      }
      index = i;

      // 所有中间件执行完毕
      if (i === middlewares.length) return;

      // 显式受控阻断：尊重中间件的有意拦截语义
      if ((context as any).isInterrupted === true) return;

      const middleware = middlewares[i];
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

        // 三态严格语义：
        //   - 调用 next()           → 继续执行后续中间件（正常流转）
        //   - isInterrupted = true  → 有意阻断，管道在此终止（权限拒绝、内容过滤等）
        //   - 两者均未执行          → 记录错误，不主动穿透安全边界
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
   * 记录所有声明了 isCritical=true 的关键服务名称。
   * 即使服务初始化失败，对关键服务的访问直接抛出致命错误，防止静默降级掩盖异常。
   */
  private criticalServiceNames = new Set<string>();
  private activeControllers = new Set<AbortController>();

  /** 消息总线订阅者路由表：topic -> [{ handler, priority }] */
  private subscribers = new Map<
    string,
    Array<{
      handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>;
      priority: number;
    }>
  >();
  private pipelines = new Map<string, IPipeline<any>>();

  constructor() {
    this.registerPipeline("input");
    this.registerPipeline("output");
    this.registerPipeline("settings");
  }

  async registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<void> {
    if (this.services.has(name)) {
      console.warn(`[Kernel] Service "${name}" is already registered. Destroying existing instance before overwriting...`);
      await this.destroyService(name);
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
   * 批量注册服务，使用 Kahn 算法根据 dependencies 进行拓扑排序，按正确的依赖顺序初始化服务。
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
      // 关键服务（isCritical=true）缺失在任何环境均属于致命错误，必须立即暴露。
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

  hasService(name: string): boolean {
    return this.services.has(name);
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

  subscribe(
    topic: string,
    handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>,
    priority = 0
  ): () => void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    const entry = { handler, priority };
    const list = this.subscribers.get(topic)!;
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
    return () => {
      this.unsubscribe(topic, handler);
    };
  }

  unsubscribe(
    topic: string,
    handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>
  ): void {
    const list = this.subscribers.get(topic);
    if (list) {
      const filtered = list.filter(item => item.handler !== handler);
      if (filtered.length === 0) {
        this.subscribers.delete(topic);
      } else {
        this.subscribers.set(topic, filtered);
      }
    }
  }

  async publish(message: IMessage): Promise<void> {
    const list = this.subscribers.get(message.topic);
    if (!list) return;
    for (const { handler } of list) {
      const controller = new AbortController();
      this.activeControllers.add(controller);
      const signal = controller.signal;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => {
            controller.abort();
            reject(new Error(`[Kernel] Publish subscriber on "${message.topic}" timed out after ${MSG_TIMEOUT_MS}ms.`));
          },
          MSG_TIMEOUT_MS
        );
      });

      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
        } else {
          // { once: true }：abort 触发后自动移除监听器，防止监听器悬空泄漏
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }
      });

      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            try {
              resolve(handler(message, signal) as any);
            } catch (e) {
              reject(e);
            }
          }),
          timeout,
          abortPromise,
        ]).finally(() => {
          if (timerId) clearTimeout(timerId);
        });
      } catch (err: any) {
        controller.abort();
        if (err && err.message === "aborted") {
          // 静默退出，且直接中断后续订阅者发布（已发生信号中止）
          break;
        } else {
          console.error(`[Kernel] Error executing subscriber on topic "${message.topic}":`, err);
          // 遇到超时异常，立刻熔断中断后续执行，防止 5s 串行累加死锁
          if (err && err.message && err.message.includes("timed out")) {
            break;
          }
        }
      } finally {
        this.activeControllers.delete(controller);
      }
    }
  }

  async publishParallel(message: IMessage): Promise<void> {
    const list = this.subscribers.get(message.topic);
    if (!list) return;

    const withTimeout = ({ handler }: { handler: Function }): Promise<void> => {
      const controller = new AbortController();
      this.activeControllers.add(controller);
      const signal = controller.signal;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => {
            controller.abort();
            reject(new Error(`[Kernel] Parallel subscriber on "${message.topic}" timed out after ${MSG_TIMEOUT_MS}ms.`));
          },
          MSG_TIMEOUT_MS
        );
      });

      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
        } else {
          // { once: true }：abort 触发后自动移除监听器，防止监听器悬空泄漏
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }
      });

      return Promise.race([
        new Promise<void>((resolve, reject) => {
          try {
            resolve(handler(message, signal) as any);
          } catch (e) {
            reject(e);
          }
        }),
        timeout,
        abortPromise,
      ]).finally(() => {
        if (timerId) clearTimeout(timerId);
        this.activeControllers.delete(controller);
      }).catch((err) => {
        controller.abort();
        throw err;
      });
    };

    const results = await Promise.allSettled(list.map(withTimeout));
    for (const result of results) {
      if (result.status === "rejected") {
        const err = result.reason;
        if (err && err.message === "aborted") {
          continue;
        }
        console.error(`[Kernel] Error executing parallel subscriber on topic "${message.topic}":`, result.reason);
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

    // 逆序销毁：从上层业务服务到底层基础服务自顶向下销毁，确保销毁钩子可安全访问底层服务。
    const serviceNames = Array.from(this.services.keys()).reverse();
    for (const name of serviceNames) {
      await this.destroyService(name);
    }
    this.services.clear();
    this.criticalServiceNames.clear();
    this.subscribers.clear();
    this.pipelines.clear();
    this.extensions.clear();
    console.log("[Kernel] Kernel base destroyed successfully.");
  }
}

/**
 * 工厂函数：创建一个全新的、独立的 Kernel 实例。
 * 供单元测试或测试环境隔离使用，避免全局状态共享污染。
 */
export function createKernel(): Kernel {
  return new Kernel();
}

export const globalKernel = new Kernel();
