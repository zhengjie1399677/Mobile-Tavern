import { IKernel, IKernelService, IPipeline, Middleware, IExtension, IMessage, type KernelValidationMode } from "./types";
import { SAFE_PROXY_SYMBOL, validateMessage, validateService, validateServiceRetrieval, type ValidationResult } from "./schemas";
import { reportImmediate } from "../utils/telemetry";
import { Logger } from "../utils/logger";

import { getErrorMessage, getErrorName } from '../utils/errorUtils';
const logger = Logger.create("Kernel");

// 全局严格模式开关，默认为 true
let strictMode = true;
let serviceValidationMode: KernelValidationMode = "warn";

/**
 * 设置内核严格模式开关
 * @param val 开关值
 */
export const setKernelStrictMode = (val: boolean) => {
  strictMode = val;
};

/**
 * 设置服务注册与获取的运行时契约校验策略。
 * 默认 warn：记录错误但不改变既有服务生命周期语义；strict 供 CI 或开发环境阻断错误实现。
 */
export const setKernelServiceValidationMode = (mode: KernelValidationMode): void => {
  serviceValidationMode = mode;
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

const describeValidationFailure = (result: ValidationResult): string => {
  if (result.success !== false) return "";
  return `${result.summary}: ${result.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
    .join("; ")}`;
};

/**
 * 消息处理器单次执行超时阈值（毫秒）。
 * 防止劣质插件的异步死锁或网络挂起拖垮消息总线核心分发流程。
 * publish 和 publishParallel 均对每个订阅者处理器独立计时，
 * 超时后触发 abort 熔断以防挂起，不会阻断整个事件链。
 */
const MSG_TIMEOUT_MS = 5000;

// 记录已发出缺失告警的服务名，避免刷屏
const warnedServices = new Set<string>();
const warnedServiceValidation = new Set<string>();

// 按服务名缓存 SafeProxy 实例，保证同一缺失服务多次 getService 返回同一引用，
// 避免调用方基于 === 的引用比较/缓存判断失效。
const safeProxyCache = new Map<string, any>();

// 改进-2 / 7.3.1: SafeProxy 接管次数计数器。
// 旧实现 warnedServices 只告警一次，后续调用完全静默，生产环境功能静默失效无法排障。
// 现在每次属性访问递增计数，达到阈值时上报遥测告警，之后每 N 次再上报一次保持持续可观测性。
const safeProxyAccessCount = new Map<string, number>();
const SAFE_PROXY_WARN_THRESHOLD = 10;       // 首次告警阈值
const SAFE_PROXY_REPORT_INTERVAL = 50;       // 后续每 50 次再上报一次

/**
 * 重置 SafeProxy 模块级状态（warnedServices / safeProxyCache / safeProxyAccessCount）。
 *
 * 用途：Kernel 重建（HMR、测试隔离）时清理上一轮残留，避免：
 *   - 旧 Kernel 已销毁的服务在新 Kernel 中因缓存命中仍返回 SafeProxy
 *   - 告警去重 Set 残留导致新 Kernel 中缺失服务不再告警
 *   - 计数器残留导致阈值告警时机错乱
 */
export function resetSafeProxyState(): void {
  warnedServices.clear();
  warnedServiceValidation.clear();
  safeProxyCache.clear();
  safeProxyAccessCount.clear();
}

/**
 * 记录一次 SafeProxy 属性访问，按阈值上报遥测与告警。
 */
function trackSafeProxyAccess(name: string, prop: string): void {
  const count = (safeProxyAccessCount.get(name) ?? 0) + 1;
  safeProxyAccessCount.set(name, count);

  if (count === SAFE_PROXY_WARN_THRESHOLD) {
    // 达到阈值：功能静默失效已不是偶发，上报告警
    logger.warn(`[Kernel] SafeProxy access threshold exceeded for service "${name}"`, {
      service: name,
      accessCount: count,
      lastProperty: prop,
    });
    try {
      reportImmediate("safe_proxy_threshold_exceeded", {
        service: name,
        accessCount: count,
      }).catch(() => { /* 遥测不可用时不影响 Kernel */ });
    } catch { /* 同步异常兜底 */ }
  } else if (count > SAFE_PROXY_WARN_THRESHOLD && (count - SAFE_PROXY_WARN_THRESHOLD) % SAFE_PROXY_REPORT_INTERVAL === 0) {
    // 后续周期性上报，保持持续可观测性而不刷屏
    try {
      reportImmediate("safe_proxy_threshold_exceeded", {
        service: name,
        accessCount: count,
        recurring: true,
      }).catch(() => { /* 遥测不可用时不影响 Kernel */ });
    } catch { /* 同步异常兜底 */ }
  }
}

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
    // has trap：向 schemas/index.ts 的 isSafeProxy 契约检测（SAFE_PROXY_SYMBOL in service）
    // 暴露标记，使 validateServiceRetrieval 能识别本代理并跳过 P0 schema 校验（Phase C 接入点）。
    // 注意：in 运算符走 has trap 而非 get trap，因此 get 中的 Symbol 短路不影响此检测。
    has(target, prop) {
      if (prop === SAFE_PROXY_SYMBOL) return true;
      return prop in target;
    },
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
        // 改进-2: 每次属性访问都记录，按阈值上报遥测
        trackSafeProxyAccess(name, prop);

        if (getKernelStrictMode()) {
          // 开发严格模式下直接抛错，确保开发者在开发阶段尽早发现服务依赖缺失
          throw new Error(
            `[Kernel DevError] Service "${name}" is not registered or failed to initialize. ` +
            `Denying property access "${prop}" on SafeProxy in development mode.`
          );
        } else {
          // 首次告警（去重），后续依赖 trackSafeProxyAccess 的阈值遥测保持可观测性
          if (!warnedServices.has(name)) {
            warnedServices.add(name);
            logger.warn("Missing service, returning SafeProxy fallback", { service: name });
          }
          if (isDev()) {
            // 开发非严格模式下输出警告日志
            logger.warn("Accessing property on SafeProxy in dev mode", { service: name, property: prop });
          }
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
      // 注：T 无类型约束，isInterrupted 为 Pipeline 运行时注入的阻断标记字段
      if ((context as { isInterrupted?: boolean }).isInterrupted === true) return;

      const middleware = middlewares[i];
      let nextCalled = false;
      const nextWrapper = async (): Promise<void> => {
        nextCalled = true;
        await dispatch(i + 1);
      };

      const interruptWrapper = () => {
        (context as { isInterrupted?: boolean }).isInterrupted = true;
      };

      try {
        await middleware.fn(context, nextWrapper, interruptWrapper);

        // 三态严格语义校验：
        //   - 调用 next()           → 继续执行后续中间件（正常流转）
        //   - isInterrupted = true  → 有意阻断，管道在此终止（权限拒绝、内容过滤等）
        //   - 两者均未执行          → 记录错误，不主动穿透安全边界
        if (!nextCalled && (context as { isInterrupted?: boolean }).isInterrupted !== true) {
          if (getKernelStrictMode()) {
            throw new Error(
              `[Pipeline DevError] Middleware "${middleware.fn.name || "anonymous"}" (index ${i}) ` +
              `finished execution without calling next() and without calling interrupt(). ` +
              `This is a design logic violation. Use the third parameter interrupt() for intentional blocking.`
            );
          } else {
            // 生产环境：记录错误但绝不自动穿透。
            // 若该中间件是有意阻断，自动穿透将导致安全漏洞；若是遗忘，亦应被修复而非掩盖。
            logger.error(
              `Pipeline middleware finished without calling next() or interrupt(). Pipeline halted to preserve security boundary. This is a bug — fix the middleware.`,
              undefined,
              { middleware: middleware.fn.name || "anonymous", index: i }
            );
          }
        }
      } catch (err: unknown) {
        if (getKernelStrictMode()) {
          // 开发环境直接抛出，不遮掩任何错误
          throw err;
        } else {
          // 生产环境：记录错误并终止管道，不自动跳过出错的中间件以保全运行边界
          logger.error(
            `Pipeline middleware threw an exception. Pipeline halted.`,
            err,
            { middleware: middleware.fn.name || "anonymous", index: i }
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
  private serviceMetadata = new Map<string, { state: string; initTime?: number }>(); // 服务元数据（状态、初始化耗时等）
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
    this.validateServiceAtRegistration(name, service);
    if (this.services.has(name)) {
      logger.warn("Service is already registered. Destroying existing instance before overwriting", { service: name });
      await this.destroyService(name);
    }

    // 在 init() 之前就标记关键服务，确保即使初始化失败或超时，在 getService 时也能受到致命错误拦截保护
    if (service.isCritical) {
      this.criticalServiceNames.add(name);
    }

    this.serviceMetadata.set(name, { state: "initializing" });
    const startTime = Date.now();

    const controller = new AbortController();
    this.activeControllers.add(controller);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    // Promise.resolve().then 包装：init 同步抛错与异步 rejection 统一转为 rejected Promise，进入同一 catch 路径
    let initPromise: Promise<void> = Promise.resolve().then(() => service.init(this, controller.signal));

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
      const initTime = Date.now() - startTime;
      this.serviceMetadata.set(name, { state: "ready", initTime });
      logger.info("Service registered and initialized successfully", { service: name, initTimeMs: initTime });
    } catch (err: unknown) {
      if (timeoutId) clearTimeout(timeoutId);
      controller.abort(); // 若初始化异常，立刻触发 abort 中止内部已经拉起但未释放的临时状态
      logger.error(`Service FAILED to initialize`, err, { service: name });
      this.services.delete(name);
      this.serviceMetadata.set(name, { state: "failed" });
      const isTimeout = getErrorMessage(err) && getErrorMessage(err).includes("timed out");
      // 关键服务失败或任何初始化超时均视为致命异常，直接向上抛出，并防止前台应用挂死
      if (service.isCritical || isTimeout) {
        throw new Error(`[Kernel] Fatal: ${isTimeout ? "Timeout" : "Critical"} service "${name}" failed to initialize: ${getErrorMessage(err) || err}`);
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
          if (!this.services.has(dep)) {
            throw new Error(
              `[Kernel] Missing required dependency "${dep}" for service "${name}". ` +
              `Add it to this batch, register it before this batch, or declare it in optionalDependencies.`
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

    // 按计算出来的安全拓扑顺序依次串行注册并初始化。
    // 若中途失败（关键服务异常或超时），逆序销毁本次批量中已成功注册的服务，
    // 防止 Kernel 残留半初始化状态导致后续 initialize 二次注册冲突或资源泄露。
    const registered: string[] = [];
    try {
      for (const { name, service, initTimeoutMs } of sorted) {
        await this.registerService(name, service, initTimeoutMs);
        // registerService 对非关键/非超时失败会静默标记 "failed" 且不抛出，
        // 此时 services 中不含该项；仅记录实际进入 services 的成功项用于回滚。
        if (this.services.has(name)) {
          registered.push(name);
        }
      }
    } catch (err) {
      // 逆序销毁已成功注册的服务（后注册的先销毁，符合 destroy 时的逆序原则）
      for (let i = registered.length - 1; i >= 0; i--) {
        try {
          await this.destroyService(registered[i]);
        } catch (cleanupErr) {
          // 清理失败不应掩盖原始错误，仅记录
          logger.error(`Cleanup during batch rollback failed`, cleanupErr, { service: registered[i] });
        }
      }
      throw err;
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
      logger.warn("Service is not registered or failed to initialize. Returning safe no-op fallback proxy", { service: name });
      // 走缓存保证同名服务返回同一 SafeProxy 引用（warnedServices 仅去重日志，此处去重对象）
      let proxy = safeProxyCache.get(name);
      if (!proxy) {
        proxy = createSafeProxy(name);
        safeProxyCache.set(name, proxy);
        // 接入遥测管道：每次新出现缺失服务降级时上报一次，供可观测性分析定位 SafeProxy 接管事件
        // 失败兜底：遥测管道自身异常不得影响 Kernel 主流程，亦不得演化为 unhandled rejection
        try {
          reportImmediate("kernel_safe_proxy_fallback", { service: name }).catch(() => {
            // 静默：遥测不可用时不污染 Kernel 行为
          });
        } catch {
          // 同步异常兜底（如遥测模块加载失败）
        }
      }
      return proxy as unknown as T;
    }
    this.validateServiceAtRetrieval(name, service);
    return service as T;
  }

  /** 服务注册入口的 schema 防腐层。warn 模式保持既有兼容行为，strict 用于阻断错误实现。 */
  private validateServiceAtRegistration(name: string, service: unknown): void {
    this.handleServiceValidation("registration", name, validateService(name, service));
  }

  /** 服务获取入口的 schema 防腐层；SafeProxy 会由 validateServiceRetrieval 自动降级放行。 */
  private validateServiceAtRetrieval(name: string, service: unknown): void {
    this.handleServiceValidation("retrieval", name, validateServiceRetrieval(name, service));
  }

  private handleServiceValidation(
    operation: "registration" | "retrieval",
    name: string,
    result: ValidationResult
  ): void {
    if (serviceValidationMode === "off" || result.success) return;
    const detail = describeValidationFailure(result);
    const message = `[Kernel ServiceValidation] ${operation} rejected for "${name}": ${detail}`;
    if (serviceValidationMode === "strict") {
      throw new Error(message);
    }
    const warningKey = `${operation}:${name}:${detail}`;
    if (!warnedServiceValidation.has(warningKey)) {
      warnedServiceValidation.add(warningKey);
      logger.error(`${message}; continuing because validation mode is warn.`);
    }
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

        const destroyPromise: Promise<void> = Promise.resolve().then(() => service.destroy!(this, controller.signal));
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
          logger.error(`Error executing destroy on service`, err, { service: name });
        } finally {
          this.activeControllers.delete(controller);
        }
      }
      this.services.delete(name);
      this.serviceMetadata.set(name, { state: "destroyed" });
      logger.info("Service destroyed and removed", { service: name });
    }
  }

  /**
   * 显式注册一个新命名过滤管道
   */
  registerPipeline<T = any>(name: string): IPipeline<T> {
    if (this.pipelines.has(name)) {
      logger.warn("Pipeline is already registered. Returning existing instance", { pipeline: name });
      return this.pipelines.get(name) as IPipeline<T>;
    }
    const pipeline = new Pipeline<T>();
    this.pipelines.set(name, pipeline);
    logger.info("Pipeline registered", { pipeline: name });
    return pipeline;
  }

  /**
   * 获取已显式注册的过滤管道。
   * 未知名称通常意味着插件漏注册或调用方拼写错误，禁止在读取操作中隐式修改 Kernel 拓扑。
   */
  getPipeline<T = any>(name: string): IPipeline<T> {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(
        `[Kernel] Pipeline "${name}" is not registered. ` +
        `Call registerPipeline("${name}") during bootstrap or plugin activation before reading it.`
      );
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
    if (!this.validatePublishedMessage(message)) return;
    // 入口快照订阅者列表：for...of 期间存在 await，期间 subscribe（push+sort）/unsubscribe（filter 换新数组）
    // 可能并发修改原数组或触发 sort 影响迭代稳定性。快照后本轮发布语义固化为发布时刻的订阅者集合。
    const list = [...(this.subscribers.get(message.topic) ?? [])];
    if (list.length === 0) return;
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
              resolve(handler(message, signal));
            } catch (e) {
              reject(e);
            }
          }),
          timeout,
          abortPromise,
        ]).finally(() => {
          if (timerId) clearTimeout(timerId);
        });
      } catch (err: unknown) {
        controller.abort();
        if (err && getErrorMessage(err) === "aborted") {
          // 静默退出，且直接中断后续订阅者发布（已发生信号中止）
          break;
        } else {
          logger.error(`Error executing subscriber on topic`, err, { topic: message.topic });
          // 遇到任何订阅者处理超时异常，立刻进行熔断中止后续执行，防止 5s 串行累加死锁
          if (err && getErrorMessage(err) && getErrorMessage(err).includes("timed out")) {
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
    if (!this.validatePublishedMessage(message)) return;
    // 入口快照订阅者列表：与 publish 同理，避免 Promise.allSettled 期间并发 subscribe/unsubscribe 影响
    const list = [...(this.subscribers.get(message.topic) ?? [])];
    if (list.length === 0) return;

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
            resolve(handler(message, signal));
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
        logger.error(`Error executing parallel subscriber on topic`, result.reason, { topic: message.topic });
      }
    }
  }

  /** 外部消息进入总线前的统一防腐校验。 */
  private validatePublishedMessage(message: unknown): message is IMessage {
    const result = validateMessage(message);
    if (result.success === true) return true;

    const detail = `${result.summary}: ${result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
      .join("; ")}`;
    if (getKernelStrictMode()) {
      throw new Error(`[Kernel MessageValidation] ${detail}`);
    }
    logger.error(`[Kernel MessageValidation] Dropped invalid message. ${detail}`);
    return false;
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
   * 检查并输出内核运行时详细数据结构（服务状态、拦截管道及扩展插槽）
   */
  inspect(): {
    services: Array<{
      name: string;
      state: string;
      initTime?: number;
    }>;
    pipelines: Array<{
      name: string;
      middlewares: ReadonlyArray<{ name: string; priority: number }>;
    }>;
    extensions: Array<{
      point: string;
      extensions: Array<{
        id: string;
        priority: number;
        componentName: string;
      }>;
    }>;
  } {
    const services = Array.from(this.serviceMetadata.entries()).map(([name, meta]) => ({
      name,
      state: meta.state,
      initTime: meta.initTime,
    }));

    const pipelines = Array.from(this.pipelines.entries()).map(([name, pipeline]) => ({
      name,
      middlewares: pipeline.list(),
    }));

    const extensions = Array.from(this.extensions.entries()).map(([point, list]) => ({
      point,
      extensions: list.map(ext => {
        let componentName = "unknown";
        if (ext.component) {
          if (typeof ext.component === "function") {
            componentName = ext.component.name || "anonymous";
          } else if (typeof ext.component === "object") {
            componentName = ext.component.name || ext.component.constructor?.name || "object";
          } else {
            componentName = String(ext.component);
          }
        }
        return {
          id: ext.id,
          priority: ext.priority ?? 0,
          componentName,
        };
      }),
    }));

    return {
      services,
      pipelines,
      extensions,
    };
  }

  /**
   * 销毁整个内核系统，逆序释放所有管道、消息队列和 IoC 服务
   */
  async destroy(): Promise<void> {
    logger.info("Destroying all core pipelines, hooks, and services");
    // 强行中止所有当前尚未结束的并发异步/定时/网络/数据库操作。
    // 快照后遍历：各 controller 被 abort 后其 finally 块会并发 activeControllers.delete(controller)，
    // 直接遍历 Set 期间被 delete 可能导致迭代器跳过未访问项，漏 abort 个别 controller。
    const controllers = [...this.activeControllers];
    for (const controller of controllers) {
      try {
        controller.abort();
      } catch (err) {
        logger.error("Error aborting active controller during destroy", err);
      }
    }
    this.activeControllers.clear();

    // P1-5: 基于依赖关系计算拓扑逆序销毁顺序。
    // 旧实现用 Array.from(services.keys()).reverse()，依赖 Map 插入顺序作为拓扑逆序的近似。
    // 但批量注册外的单独 registerService、动态注册或跨批次依赖可能导致插入顺序不严格等于拓扑顺序，
    // 此时 reverse 会先销毁被依赖的底层服务，使上层服务 destroy 钩子调用底层服务失败。
    // 修复：用 Kahn 算法在反向图上计算——被依赖次数为 0 的先销毁，销毁后递减依赖者的被依赖次数。
    const destroyOrder = this.computeDestroyOrder();
    for (const name of destroyOrder) {
      await this.destroyService(name);
    }
    this.services.clear();
    this.serviceMetadata.clear();
    this.criticalServiceNames.clear();
    this.subscribers.clear();
    this.pipelines.clear();
    this.extensions.clear();
    // 改进-2: 清理 SafeProxy 模块级状态，避免 HMR/重建后残留导致新 Kernel 中
    // 缺失服务因缓存命中仍返回 SafeProxy 或告警去重 Set 残留不再告警
    resetSafeProxyState();
    logger.info("Kernel base destroyed successfully");
  }

  /**
   * 基于服务依赖声明计算销毁顺序（拓扑逆序）。
   *
   * 规则：若 A 依赖 B（B 在 A 的 dependencies/optionalDependencies 中且 B 已注册），
   * 则 A 必须先于 B 销毁，保证 A 的 destroy 钩子内仍能安全调用 B。
   *
   * 算法：以"被依赖次数（出度）"为判据的 Kahn BFS。
   *   - refCount[name] = name 被多少其他已注册服务依赖
   *   - 出度为 0 的服务（没人依赖它）先入队销毁，可安全释放
   *   - 销毁某服务后，对它依赖的每个服务递减出度，归零则入队
   *
   * 循环依赖兜底：若拓扑产出不完整（存在环），将剩余服务按注册顺序逆序追加到末尾，
   * 避免环内服务永久漏销毁。
   */
  private computeDestroyOrder(): string[] {
    const serviceNames = Array.from(this.services.keys());
    if (serviceNames.length === 0) return [];

    const nameSet = new Set(serviceNames);
    // depsMap: 服务 → 它依赖的已注册服务列表
    const depsMap = new Map<string, string[]>();
    // refCount: 服务被多少其他已注册服务依赖（出度）
    const refCount = new Map<string, number>();

    for (const name of serviceNames) {
      depsMap.set(name, []);
      refCount.set(name, 0);
    }

    for (const name of serviceNames) {
      const service = this.services.get(name)!;
      const deps = [
        ...(service.dependencies ?? []),
        ...(service.optionalDependencies ?? []),
      ];
      for (const dep of deps) {
        if (dep === name) continue;
        if (nameSet.has(dep)) {
          depsMap.get(name)!.push(dep);
          refCount.set(dep, (refCount.get(dep) ?? 0) + 1);
        }
      }
    }

    // 出度为 0（没人依赖）的先销毁
    const queue: string[] = [];
    for (const [name, count] of refCount) {
      if (count === 0) queue.push(name);
    }

    const ordered: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      // current 销毁后，递减 current 依赖的服务的被依赖次数
      for (const dep of depsMap.get(current) ?? []) {
        const newCount = (refCount.get(dep) ?? 0) - 1;
        refCount.set(dep, newCount);
        if (newCount === 0) queue.push(dep);
      }
    }

    if (ordered.length !== serviceNames.length) {
      // 循环依赖兜底：未排序的服务按注册顺序逆序追加到末尾
      const orderedSet = new Set(ordered);
      logger.warn("Circular dependency detected during destroy, falling back to reverse registration order for remaining services", {
        remaining: serviceNames.filter(n => !orderedSet.has(n)),
      });
      for (let i = serviceNames.length - 1; i >= 0; i--) {
        if (!orderedSet.has(serviceNames[i])) {
          ordered.push(serviceNames[i]);
        }
      }
    }

    return ordered;
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
