export const KernelServices = {
  Database: "database",
  LLM: "llm",
  Prompt: "prompt",
  Telemetry: "telemetry",
  Script: "script",
  MultiMessage: "multiMessage",
  ChatStream: "chatStream",
  UpdateCheck: "updateCheck",
  Memory: "memory",
  ImageGen: "imageGen",
  Bgm: "bgm",
  Tts: "tts",
  Asr: "asr",
  Character: "character",
  Worldbook: "worldbook",
  Settings: "settings",
  Preset: "preset",
} as const;

export type InterruptFn = () => void;

/** Kernel 运行时契约校验的处置策略。 */
export type KernelValidationMode = "strict" | "warn" | "off";

export type Middleware<T> = (context: T, next: () => Promise<void>, interrupt: InterruptFn) => Promise<void> | void;

export interface StreamChunk {
  content?: string;
  reasoning_content?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  __rescuedContent?: string;
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

export interface StreamParams {
  baseUrl: string;
  apiKey: string;
  chatPath?: string;
  bypassProxy?: boolean;
  disableReasoning?: boolean;
  forceBasicParams?: boolean;
  reqBody: any;
  signal?: AbortSignal;
}

export interface IChatStreamService extends IKernelService {
  streamLlmResponse(params: StreamParams): AsyncGenerator<StreamChunk, void, unknown>;
}

// 注：OutputPipelineContext 已上移到 src/services/pipeline/types.ts，
// kernel 仅保留 IPipeline<T> 泛型契约，不再反向依赖上层业务实体类型。

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
  hasService(name: string): boolean;
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

export interface IDatabaseService<TSession = any, TCharacter = any, TSummary = any> extends IKernelService {
  getAllSessions(): Promise<TSession[]>;
  /**
   * P0-2 基础设施：按主键单条直查会话，避免 getAllSessions() 全量反序列化。
   * 用于 AutoSummaryService 等仅需查找当前会话的场景。
   */
  getSessionById(id: string): Promise<TSession | null>;
  // PERF-03: 分页加载 API，避免一次性 getAll() 阻塞主线程
  getSessionsCount(): Promise<number>;
  getSessionsPaginated(page: number, pageSize: number): Promise<TSession[]>;
  saveSession(session: TSession, signal?: AbortSignal): Promise<void>;
  /**
   * 在 sessions Store 内原子追加摘要并推进最后总结位置。
   * 这是会话聚合能力，不暴露记忆词典、召回等业务专用存储细节。
   */
  appendSessionSummary(
    sessionId: string,
    summary: TSummary,
    signal?: AbortSignal
  ): Promise<TSession>;
  /**
   * 单条消息写入 messages Store（用于发送/重投场景的精准单条持久化）。
   * saveSession 只存会话元数据，新消息必须通过本方法显式写入。
   */
  appendSessionMessage(sessionId: string, message: any, turnIndex?: number, signal?: AbortSignal): Promise<void>;
  /**
   * 按主键删除单条消息（用于重投/编辑场景删除旧消息）。
   */
  deleteMessageById(id: string, signal?: AbortSignal): Promise<void>;
  /** 原子替换重发分支：会话元数据、旧消息删除和新消息写入同事务提交。 */
  replaceSessionBranch(
    session: TSession,
    removedMessageIds: string[],
    newMessages: any[],
    signal?: AbortSignal
  ): Promise<void>;
  /**
   * 批量同步会话消息（用于分支创建/备份恢复等全量写入场景）。
   * 仅 PUT upsert，不做孤儿清理。
   */
  syncSessionMessages(sessionId: string, messages: any[], signal?: AbortSignal): Promise<void>;
  deleteSession(id: string, signal?: AbortSignal): Promise<void>;
  /**
   * 批量写入会话（备份恢复 / 跨设备同步场景）。
   * 跨 sessions+messages Store 事务，用于一次性导入完整对话历史。
   */
  bulkSaveSessions(sessionsList: TSession[], signal?: AbortSignal): Promise<void>;
  createNewSession(character: any, starterMessage?: string, initialSuggestions?: string[]): Promise<TSession>;
  createEmptyBranch(character: any, title: string): Promise<TSession>;
  createBacktrackBranch(sourceSession: TSession, title: string, msgId: string): Promise<TSession>;
  createBacktrackFromTimeline(sourceSession: TSession, title: string, summaryId: string): Promise<TSession>;
  /**
   * P0-4 / P1-4 基础设施：按主键单条直查角色卡，避免 getAllCharacters() 全量反序列化。
   */
  getCharacterById(id: string): Promise<TCharacter | null>;
}

export interface ILLMService extends IKernelService {
  universalFetch(
    type: string,
    config: {
      baseUrl: string;
      apiKey: string;
      chatPath?: string;
      bypassProxy?: boolean;
      disableReasoning?: boolean;
      forceBasicParams?: boolean;
      reqBody: any;
    },
    signal?: AbortSignal
  ): Promise<Response>;
  isClientMode(): boolean;
  sendCatbotRequest(
    content: string,
    history: any[],
    clientContext?: unknown
  ): Promise<{ reply: string; expression: string }>;
}

export interface IPromptService<TCharacter = any, TSession = any, TSettings = any, TLorebook = any> extends IKernelService {
  assemblePrompt(params: {
    character: TCharacter;
    chat: TSession;
    userInput: string;
    settings: TSettings;
    globalLorebook: TLorebook[];
    recalledMemories?: unknown[];
  }): {
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; name?: string; content: string }>;
    dynamicInstruction: string;
    userInput?: string;
    messages?: Array<{ role: "system" | "user" | "assistant"; name?: string; content: string }>;
    diagnostics?: Array<{
      level: "info" | "warning" | "error";
      code: string;
      message: string;
      blockId?: string;
      detail?: string;
    }>;
  };
  cleanNameForApi(name: string | undefined, fallback: string): string | undefined;
  estimateTokens(text: string): number;
  sanitizeName(name: string): string;
  getTriggeredLorebookEntries(
    messages: any[],
    userInput: string,
    entries: TLorebook[],
    maxRecursionDepth?: number
  ): TLorebook[];
  replaceMacros(
    text: string,
    params: {
      char: string;
      user: string;
      description: string;
      personality: string;
      scenario: string;
      userPersona?: string;
      mes_example?: string;
    }
  ): string;
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
    completionTokens: number,
    characterName?: string,
    playerName?: string
  ): void;
  reportImmediate(action: string, extraData?: Record<string, any>): Promise<void>;
  reportColdStartReady(): Promise<void>;
  reportChatLoadTime(durationMs: number): void;
  reportDbQueueTimeout(queueDelayMs: number, queueLength: number): void;
  reportZodValidationError(errorDetail: string, path: string, inputVal: any): void;
}

export interface IScriptService<TCharacter = any, TSession = any> extends IKernelService {
  initializeMvuFromCharacter(character: TCharacter): Record<string, any>;
  parseMvuMessage(messageContent: string, currentVariables: Record<string, any>, signal?: AbortSignal): Record<string, any>;
  executeMvuScript(session: TSession, messageContent: string): Promise<TSession>;
  registerBridge(bridge: any): void;
}

export interface IMultiMessageService<TSession = any> extends IKernelService {
  queueUserMessage(session: TSession, text: string): Promise<TSession>;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  message?: string;
  enablePush?: boolean;
}

export interface IUpdateCheckService extends IKernelService {
  checkUpdate(currentVersion: string, signal?: AbortSignal, force?: boolean): Promise<UpdateInfo>;
}

export interface IImageGenerationService extends IKernelService {
  generateImage(prompt: string, config: any, signal?: AbortSignal): Promise<string>;
}

/**
 * 背景音乐服务接口。
 * 对应 BgmService 实现，负责 BGM 播放控制与状态查询。
 */
export interface IBgmService extends IKernelService {
  play(url: string, volume?: number): void;
  stop(): void;
  mute(): void;
  unmute(): void;
  toggleMute(): boolean;
  getCurrentUrl(): string;
  getMuteState(): boolean;
}

/**
 * 记忆系统服务接口（物理分轨存储 + 分层认知记忆架构）。
 * 整合底层存储 (Storage)、实体/事件抽取 (Extractor)、标签召回 (Recall)、状态表 (StateTable) 及剧情摘要 (Summary)。
 *
 * 泛型参数说明（默认 any 保持向后兼容，与 IDatabaseService / IPromptService 范式对齐）：
 * 实现类应绑定具体子模块类型，例如：
 *   `class MemoryService implements IMemoryService<MemoryStorage, MemoryExtractor, ...>`
 * 消费方可通过类型别名（如 MemoryServiceTyped）一次性获取具体类型，避免重复书写 5 个泛型参数。
 */
export interface IMemoryService<
  TStorage = any,
  TExtractor = any,
  TRecall = any,
  TStateTable = any,
  TSummary = any
> extends IKernelService {
  /**
   * 获取存储层 OOP 入口（messages / memory_dict Store CRUD）。
   * 供中间件与未来子模块复用。
   */
  getStorage(): TStorage;
  /**
   * 获取抽取器（L0 LLM 抽取 + L1 词典匹配 + 调度队列）。
   * 阶段 B 装配，供 output 中间件异步触发抽取。
   */
  getExtractor(): TExtractor;
  /**
   * 获取召回器（标签倒排索引 + 时间衰减打分）。
   * 阶段 B 装配，供 input 中间件召回相关历史注入 Prompt。
   */
  getRecall(): TRecall;
  /**
   * 获取状态表子模块（合并自 TableMemoryService）。
   * 阶段 C 装配，供 output 中间件解析 AI 表格指令并执行 CRUD。
   */
  getStateTable(): TStateTable;
  /**
   * 获取摘要子模块（瘦身自 AutoSummaryService）。
   * 阶段 C 装配，供 output 中间件触发剧情时间线摘要。
   */
  getSummary(): TSummary;
}

export interface ITtsService extends IKernelService {
  speak(text: string, config: any, signal?: AbortSignal): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  isSpeaking(): boolean;
  getSpeakingMessageId(): string | null;
  setSpeakingMessageId(id: string | null): void;
}

export interface AsrConfig {
  enabled: boolean;
  provider: "web-speech" | "openai";
  language: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
}

export interface IAsrService extends IKernelService {
  isListening(): boolean;
  startListening(
    config: AsrConfig,
    onResult: (text: string, isFinal: boolean) => void,
    onError: (err: unknown) => void,
    onEnd?: () => void
  ): Promise<void>;
  stopListening(): void;
  cancelListening(): void;
}

export interface ICharacterService extends IKernelService {
  getAllCharacters(): Promise<any[]>;
  saveCharacter(character: any): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  bulkSaveCharacters(charactersList: any[]): Promise<void>;
  getStoredDefaultCharactersInitializedFlag(): Promise<boolean>;
  saveStoredDefaultCharactersInitializedFlag(initialized: boolean): Promise<void>;
}

export interface IWorldbookService extends IKernelService {
  getGlobalLorebook(): Promise<any[]>;
  saveGlobalLorebook(entries: any[]): Promise<void>;
  getCustomWorldbooks(): Promise<Record<string, any>>;
  saveCustomWorldbooks(worldbooks: Record<string, any>): Promise<void>;
}

export interface ISettingsService<TSettings = any> extends IKernelService {
  getStoredSettings(): Promise<TSettings | null>;
  saveStoredSettings(settings: TSettings): Promise<void>;
}

export interface IPresetService extends IKernelService {
  getStoredSavedPresets(): Promise<any[] | null>;
  saveStoredSavedPresets(presets: any[]): Promise<void>;
}


