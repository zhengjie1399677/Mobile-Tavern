import { IKernel, IKernelService, IPipeline, Middleware, IExtension, IMessage } from "./types";

// 全局严格模式开关，默认为 true
let strictMode = true;

/**
 * 设置内核严格模式开关
 * @param val 开关值
 */
export const setKernelStrictMode = (val: boolean) => {
  strictMode = val;
};

/**
 * 判断当前是否处于开发环境
 * 优先读取 process.env.NODE_ENV 或 import.meta.env.PROD
 */
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
  return true; // 默认开发环境
};

/**
 * 获取内核是否当前应执行严格的模式校验
 * 只有在开发环境且 strictMode 为 true 时才生效
 */
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

/**
 * 创建安全无操作的 Fallback 代理对象 (SafeProxy)
 * 当调用的非关键服务未注册或初始化失败时，返回此代理，防止前台页面级组件在尝试链式调用时直接白屏崩溃。
 * @param name 服务的名称
 */
const createSafeProxy = (name: string): any => {
  const noop = (..._args: any[]) => {
    return createSafeProxy(name);
  };

  return new Proxy(noop, {
    get(_target, prop) {
      // Symbol 属性短路保护：工具/框架探测 Symbol 属性时拦截，避免无限递归导致调用栈溢出
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") {
        // 让 Promise await 链可以正常 resolve 结束，防止 SafeProxy 在 await 时永久挂起
        return (resolve: any) => resolve(undefined);
      }
      if (prop === "name") return name;
      if (prop === "init") return () => {};

      if (typeof prop === "string" && prop !== "then" && prop !== "name" && prop !== "init") {
        if (getKernelStrictMode()) {
          // 开发严格模式下直接抛错，确保开发者在开发阶段尽早发现服务依赖缺失
          throw new Error(
            `[Kernel DevError] Service "${name}" is not registered or failed to initialize. ` +
            `Denying property access "${prop}" on SafeProxy in development mode.`
          );
        } else if (isDev()) {
          // 开发非严格模式下输出警告日志
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

// ─── Pipeline (管道流中间件机制) ────────────────────────────────────────────────

/**
 * 管道机制实现类
 * 类似于 Koa 的洋葱模型，支持优先级调度，主要用于处理文本输入、输出清洗及配置生命周期过滤
 */
class Pipeline<T> implements IPipeline<T> {
  // 内部维护的中间件列表，包含中间件函数和优先级
  private middlewares: Array<{ fn: Middleware<T>; priority: number }> = [];

  /**
   * 注册中间件
   * @param middleware 中间件函数
   * @param priority 优先级（数值越大越先执行，默认为 0）
   * @returns 注销该中间件的函数
   */
  use(middleware: Middleware<T>, priority = 0): () => void {
    const entry = { fn: middleware, priority };
    this.middlewares.push(entry);
    // 按优先级降序排列，高优先级中间件先执行
    this.middlewares.sort((a, b) => b.priority - a.priority);
    return () => {
      this.middlewares = this.middlewares.filter(m => m !== entry);
    };
  }

  /**
   * 注销指定的中间件
   * @param middleware 需要注销的中间件函数
   */
  unuse(middleware: Middleware<T>): void {
    this.middlewares = this.middlewares.filter(m => m.fn !== middleware);
  }

  /**
   * 返回当前已注册的中间件列表快照（用于调试与运行时可观测性）
   */
  list(): ReadonlyArray<{ name: string; priority: number }> {
    return this.middlewares.map(m => ({
      name: m.fn.name || "(anonymous)",
      priority: m.priority,
    }));
  }

  /**
   * 异步依次执行所有中间件（洋葱模型）
   * @param context 执行上下文
   */
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

        // 三态严格语义校验：
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
            // 若该中间件是有意阻断，自动穿透将导致安全漏洞；若是遗忘，亦应被修复而非掩盖。
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
          // 生产环境：记录错误并终止管道，不自动跳过出错的中间件以保全运行边界
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

// ─── Kernel (内核主容器) ──────────────────────────────────────────────────────

/**
 * 内核系统主实现类
 * 负责集中化生命周期、IoC 服务注入、三态管道拦截、消息总线分发以及扩展插件插槽管理。
 */
export class Kernel implements IKernel {
  private services = new Map<string, IKernelService>(); // 已成功初始化注册的服务映射表
  private extensions = new Map<string, IExtension[]>(); // 扩展插槽映射表

  /**
   * 记录所有声明了 isCritical=true 的关键服务名称。
   * 对关键服务的访问如果缺失直接抛出致命错误，防止静默降级掩盖系统缺陷。
   */
  private criticalServiceNames = new Set<string>();
  // 维护当前活跃的 AbortController 集合，便于在 Kernel 销毁时统一强行中止全部异步/网络/存储挂起任务
  private activeControllers = new Set<AbortController>();

  /** 消息总线订阅者路由表：topic -> [{ handler, priority }] */
  private subscribers = new Map<
    string,
    Array<{
      handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>;
      priority: number;
    }>
  >();
  private pipelines = new Map<string, IPipeline<any>>(); // 命名拦截管道表

  constructor() {
    // 初始化注册系统内置的三大核心拦截管道
    this.registerPipeline("input");
    this.registerPipeline("output");
    this.registerPipeline("settings");
  }

  /**
   * 单个服务注册与初始化
   * @param name 服务名标识
   * @param service 服务实例
   * @param initTimeoutMs 初始化超时阈值（毫秒）
   */
  async registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<void> {
    if (this.services.has(name)) {
      console.warn(`[Kernel] Service "${name}" is already registered. Destroying existing instance before overwriting...`);
      await this.destroyService(name);
    }

    // 在 init() 之前就标记关键服务，确保即使初始化失败或超时，在 getService 时也能受到致命错误拦截保护
    if (service.isCritical) {
      this.criticalServiceNames.add(name);
    }

    const controller = new AbortController();
    this.activeControllers.add(controller);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let initPromise: Promise<void> = new Promise<void>(resolve => resolve(service.init(this, controller.signal) as any));

    // 如果指定了初始化超时时间，则采用 Promise.race 赛跑实现强制超时中止机制
    if (initTimeoutMs && initTimeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(); // 真正的中止！触发 abort 信号停止底层 IndexedDB 打开锁死或网络挂起
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
      controller.abort(); // 若初始化异常，立刻触发 abort 中止内部已经拉起但未释放的临时状态
      console.error(`[Kernel] FAILED to initialize service "${name}":`, err);
      this.services.delete(name);
      const isTimeout = err.message && err.message.includes("timed out");
      // 关键服务失败或任何初始化超时均视为致命异常，直接向上抛出，并防止前台应用挂死
      if (service.isCritical || isTimeout) {
        throw new Error(`[Kernel] Fatal: ${isTimeout ? "Timeout" : "Critical"} service "${name}" failed to initialize: ${err.message || err}`);
      }
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  /**
   * 批量注册服务
   * 使用 Kahn 拓扑排序算法，根据服务的 dependencies 关系算出正确的依赖拓扑链，按依赖顺序安全初始化所有服务。
   */
  async registerServiceBatch(
    entries: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>
  ): Promise<void> {
    const nameSet = new Set(entries.map(e => e.name));
    const inDegree = new Map<string, number>();
    // graph: dep → dependents (节点 dep 必须先于 dependent 注册初始化)
    const graph = new Map<string, string[]>();

    for (const { name } of entries) {
      inDegree.set(name, 0);
      graph.set(name, []);
    }

    for (const { name, service } of entries) {
      for (const dep of service.dependencies ?? []) {
        if (!nameSet.has(dep)) {
          // 依赖的服务并不在当前批量入参中。如果是已经在 kernel 中注册的，可以直接跳过拓扑排序
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

    // Kahn 算法：找出所有入度为 0 的节点加入队列开始 BFS 排序
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

    // 循环依赖检测：若拓扑排序产出的节点数少于输入，说明存在闭环依赖
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

    // 按计算出来的安全拓扑顺序依次串行注册并初始化
    for (const { name, service, initTimeoutMs } of sorted) {
      await this.registerService(name, service, initTimeoutMs);
    }
  }

  /**
   * 检索并获取指定名称的服务实例
   * @param name 服务名标识
   */
  getService<T extends IKernelService>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      // 关键服务（isCritical=true）如果不存在，在任何环境均属于致命错误，必须立即暴露。
      if (this.criticalServiceNames.has(name)) {
        throw new Error(
          `[Kernel] FATAL: Critical service "${name}" is not available. ` +
          `The application cannot continue safely. ` +
          `Ensure "${name}" is registered and successfully initialized before use.`
        );
      }
      // 非关键服务缺失时，返回一个无操作的 Fallback 降级安全代理，防止页面级组件在调用可选服务时崩溃
      console.warn(
        `[Kernel] Service "${name}" is not registered or failed to initialize. ` +
        `Returning safe no-op fallback proxy.`
      );
      return createSafeProxy(name) as unknown as T;
    }
    return service as T;
  }

  /**
   * 检查服务是否已成功注册并加载
   * @param name 服务名标识
   */
  hasService(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * 销毁指定名称的服务并将其移除
   * @param name 服务名标识
   */
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
            controller.abort(); // 超时后强行中止销毁生命周期内的等待挂起操作
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

  /**
   * 显式注册一个新命名过滤管道
   */
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

  /**
   * 获取指定的过滤管道
   */
  getPipeline<T = any>(name: string): IPipeline<T> {
    let pipeline = this.pipelines.get(name);
    if (!pipeline) {
      console.warn(`[Kernel] Pipeline "${name}" not found. Auto-registering a new pipeline.`);
      pipeline = this.registerPipeline<T>(name);
    }
    return pipeline as IPipeline<T>;
  }

  /**
   * 订阅消息总线事件
   * @param topic 主题名称
   * @param handler 接收消息的处理程序
   * @param priority 优先级（数值越高，串行发布时越优先接收）
   * @returns 注销订阅的快捷函数
   */
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

  /**
   * 注销消息订阅
   * @param topic 主题名称
   * @param handler 原订阅的处理函数
   */
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

  /**
   * 串行发布消息（由订阅者高优先级向低优先级依次处理，遇到超时或主动中止时进行熔断）
   * @param message 消息体
   */
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
          // 遇到任何订阅者处理超时异常，立刻进行熔断中止后续执行，防止 5s 串行累加死锁
          if (err && err.message && err.message.includes("timed out")) {
            break;
          }
        }
      } finally {
        this.activeControllers.delete(controller);
      }
    }
  }

  /**
   * 并行发布消息（所有订阅者同时独立运行，互不干扰，单个处理超时独立熔断）
   * @param message 消息体
   */
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

  /**
   * 注册扩展插件插槽组件
   */
  registerExtension(extension: IExtension): void {
    const point = extension.targetPoint;
    if (!this.extensions.has(point)) {
      this.extensions.set(point, []);
    }
    const list = this.extensions.get(point)!;
    const filtered = list.filter(ext => ext.id !== extension.id);
    filtered.push(extension);
    // 优先级降序排列，数值高者排在链条前端
    filtered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.extensions.set(point, filtered);
  }

  /**
   * 获取指定插槽下的所有扩展插件列表
   */
  getExtensions(point: string): IExtension[] {
    return this.extensions.get(point) ?? [];
  }

  /**
   * 销毁整个内核系统，逆序释放所有管道、消息队列和 IoC 服务
   */
  async destroy(): Promise<void> {
    console.log("[Kernel] Destroying all core pipelines, hooks, and services...");
    // 强行中止所有当前尚未结束的并发异步/定时/网络/数据库操作
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch (err) {
        console.error("[Kernel] Error aborting active controller during destroy:", err);
      }
    }
    this.activeControllers.clear();

    // 逆序销毁逻辑：采用先进后出，自顶向下销毁。
    // 即后加载的业务上层服务先被销毁，最基础的服务（如 DatabaseService 等）最后销毁。
    // 确保销毁生命周期钩子内仍能安全调用底层服务进行数据落盘等操作。
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

// 导出全局唯一的单例 Kernel
export const globalKernel = new Kernel();
