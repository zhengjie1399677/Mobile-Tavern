export type InterruptFn = () => void;

/** 可由 Scope 统一回收的同步或异步 Effect。 */
export type EffectDisposer = () => void | Promise<void>;

export type EffectScopeState = "active" | "disposing" | "disposed";

/** 通用父子生命周期作用域；不包含任何应用或插件业务语义。 */
export interface IEffectScope {
  readonly id: string;
  readonly state: EffectScopeState;
  /** 注册 Effect，并返回一个只执行一次的提前释放函数。 */
  add(disposer: EffectDisposer): EffectDisposer;
  /** 创建随父 Scope 一同释放的子 Scope。 */
  fork(id: string): IEffectScope;
  /** 按注册逆序释放全部 Effect；重复调用返回同一释放结果。 */
  dispose(): Promise<void>;
}

/** Kernel 运行时契约校验的处置策略。 */
export type KernelValidationMode = "strict" | "warn" | "off";

export type Middleware<T> = (context: T, next: () => Promise<void>, interrupt: InterruptFn) => Promise<void> | void;

export interface IExtension<TValue = unknown> {
  id: string;
  targetPoint: string;
  priority?: number;
  value: TValue;
  meta?: Record<string, unknown>;
}

export interface IMessage {
  topic: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface IPipeline<T> {
  use(middleware: Middleware<T>, priority?: number): () => void;
  unuse(middleware: Middleware<T>): void;
  execute(context: T): Promise<void>;
  /** 按函数注册身份判断当前管道是否只包含给定中间件集合。 */
  matches(middlewares: readonly Middleware<T>[]): boolean;
  /** 返回当前已注册的中间件列表（用于调试与可观测性） */
  list(): ReadonlyArray<{ name: string; priority: number }>;
}

export interface IKernel {
  /**
   * 单个服务注册。`initTimeoutMs` 可选，超时后按 isCritical 决定是否抛出致命错误。
   */
  registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<EffectDisposer>;
  /**
   * 批量服务注册。自动读取各服务的 `dependencies` 字段进行拓扑排序，
   * 保证依赖关系的正确注册顺序，并在检测到循环依赖时立即抛出。
   */
  registerServiceBatch(entries: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>): Promise<EffectDisposer>;
  getService<T extends IKernelService>(name: string): T;
  hasService(name: string): boolean;
  destroyService(name: string): Promise<void>;

  registerPipeline<T = unknown>(name: string): IPipeline<T>;
  getPipeline<T = unknown>(name: string): IPipeline<T>;

  // 扩展点注册与获取接口 (SPI)
  registerExtension<TValue>(extension: IExtension<TValue>): () => void;
  getExtensions<TValue = unknown>(point: string): IExtension<TValue>[];

  // MessageBus (EventBus) System
  /**
   * 订阅消息，返回注销函数。`priority` 越高越先执行（默认 0）。
   * 处理器接收 IMessage 对象以及当前分发上下文的 AbortSignal（可选）。
   */
  subscribe(topic: string, handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>, priority?: number): () => void;
  unsubscribe(topic: string, handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>): void;
  /**
   * 异步串行分发：按优先级顺序依次 await 执行所有订阅者的处理函数。
   * 发生异常或超时将做熔断隔离，不会阻断其他订阅者接收消息。
   */
  publish(message: IMessage): Promise<void>;
  /**
   * 异步并行分发：所有处理器并发执行，互不阻塞。
   */
  publishParallel(message: IMessage): Promise<void>;

  destroy(): Promise<void>;
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
  };
}

export interface IKernelService {
  name: string;
  /** 是否是系统不可缺失的关键核心服务。若为 true，getService 失败时将在任何环境抛出致命错误。 */
  isCritical?: boolean;
  /**
   * 声明本服务所依赖的其他服务名称列表。
   * 属于必选依赖：既未在当前批次也未在内核中注册时，批量注册会直接失败。
   * 用于 `registerServiceBatch` 自动拓扑排序，确保注册顺序正确。
   */
  dependencies?: readonly string[];
  /**
   * 可选依赖缺失时不会阻止服务启动，也不参与当前批次的拓扑排序。
   * 服务必须通过 `kernel.hasService()` 显式判断后再使用此类依赖。
   */
  optionalDependencies?: readonly string[];
  init(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
  destroy?(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
}
