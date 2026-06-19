export const KernelServices = {
  Database: "database",
  LLM: "llm",
  Prompt: "prompt",
  Telemetry: "telemetry",
  TableMemory: "tableMemory",
  Script: "script",
  AutoSummary: "autoSummary",
} as const;

export const KernelEvents = {
  MessageReceived: "chat:message_received",
  SessionChanged: "chat:session_changed",
  SettingsUpdated: "system:settings_updated",
} as const;

export type InterruptFn = () => void;

export type Middleware<T> = (context: T, next: () => Promise<void>, interrupt: InterruptFn) => Promise<void> | void;

export interface IExtension {
  id: string;
  targetPoint: string;
  priority?: number;
  component: any;
  meta?: Record<string, any>;
}

export interface IMessage {
  topic: string;
  payload: any;
  metadata?: Record<string, any>;
}

export interface IPipeline<T> {
  use(middleware: Middleware<T>, priority?: number): () => void;
  unuse(middleware: Middleware<T>): void;
  execute(context: T): Promise<void>;
  /** 返回当前已注册的中间件列表（用于调试与可观测性） */
  list(): ReadonlyArray<{ name: string; priority: number }>;
}

export interface IKernel {
  /**
   * 单个服务注册。`initTimeoutMs` 可选，超时后按 isCritical 决定是否抛出致命错误。
   */
  registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<void>;
  /**
   * 批量服务注册。自动读取各服务的 `dependencies` 字段进行拓扑排序，
   * 保证依赖关系的正确注册顺序，并在检测到循环依赖时立即抛出。
   */
  registerServiceBatch(entries: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>): Promise<void>;
  getService<T extends IKernelService>(name: string): T;
  destroyService(name: string): Promise<void>;

  registerPipeline<T = any>(name: string): IPipeline<T>;
  getPipeline<T = any>(name: string): IPipeline<T>;

  // 扩展点注册与获取接口 (SPI)
  registerExtension(extension: IExtension): void;
  getExtensions(point: string): IExtension[];

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
}

export interface IKernelService {
  name: string;
  /** 是否是系统不可缺失的关键核心服务。若为 true，getService 失败时将在任何环境抛出致命错误。 */
  isCritical?: boolean;
  /**
   * 声明本服务所依赖的其他服务名称列表。
   * 用于 `registerServiceBatch` 进行自动拓扑排序，确保注册顺序正确。
   * 无需手动维护注册顺序。
   */
  dependencies?: readonly string[];
  init(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
  destroy?(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
}

export interface IDatabaseService<TSession = any> extends IKernelService {
  getAllSessions(): Promise<TSession[]>;
  saveSession(session: TSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

export interface ILLMService extends IKernelService {
  universalFetch(
    type: string,
    config: {
      baseUrl: string;
      apiKey: string;
      chatPath?: string;
      bypassProxy?: boolean;
      reqBody: any;
    },
    signal?: AbortSignal
  ): Promise<Response>;
}

export interface IPromptService<TCharacter = any, TSession = any, TSettings = any, TLorebook = any> extends IKernelService {
  assemblePrompt(params: {
    character: TCharacter;
    chat: TSession;
    userInput: string;
    settings: TSettings;
    globalLorebook: TLorebook[];
  }): {
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; content: string }>;
    dynamicInstruction: string;
  };
}

export interface ITelemetryService extends IKernelService {
  reportUsage(action?: string, extraData?: Record<string, any>): void;
  incrementUsageCount(): void;
  reportLlmPerformance(
    sessionId: string,
    modelName: string,
    ttftMs: number,
    totalTokens: number,
    durationMs: number,
    promptTokens: number,
    completionTokens: number
  ): void;
}

export interface ITableMemoryService<TCharacter = any> extends IKernelService {
  processTableMemory(
    tableMemory: any[] | undefined,
    rawContent: string,
    activeCharacter?: TCharacter
  ): { updatedMemory: any[]; cleanContent: string; hasChanges: boolean };
}

export interface IScriptService<TCharacter = any, TSession = any> extends IKernelService {
  initializeMvuFromCharacter(character: TCharacter): Record<string, any>;
  parseMvuMessage(messageContent: string, currentVariables: Record<string, any>): Record<string, any>;
  executeMvuScript(session: TSession, messageContent: string): Promise<TSession>;
}

export interface IAutoSummaryService<TSession = any, TSettings = any, TCharacter = any> extends IKernelService {
  handleAutoSummaryCheck(
    session: TSession,
    settings: TSettings,
    activeCharacter: TCharacter | null,
    force: boolean,
    signal?: AbortSignal
  ): Promise<TSession>;
}
