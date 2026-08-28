import type { EffectDisposer, IKernelService } from "../kernel/types";
export * from "../kernel/types";

import type {
  PromptCompositionBudgetReport,
  PromptCompositionTrace,
} from "../domain/prompt-composition";
import type { LocalResourceMetadata } from "../domain/resources/types";
import type {
  AttachmentMetadata,
  AttachmentBackupRecord,
  AttachmentReference,
} from "../domain/attachments/types";
import type {
  AgentDriverDefinition,
  AgentHandle,
  AgentJournalEvent,
  AgentCompositionSnapshot,
  AgentMediaProcessorDefinition,
  AgentProviderDefinition,
  AgentToolDefinition,
  AgentToolApprovalDecision,
  AgentToolApprovalRequest,
  AgentTurnExecutionContext,
} from "../domain/agents/contracts";
import type {
  ToolPluginCredentialStatus,
  ToolPluginRuntimeDiagnostics,
} from "../domain/toolPlugins";
export type { ICompatibilityRuntimeService } from "./compatibility/contracts";
export type { IRuntimeProfileService } from "./runtimeProfiles/contracts";
import type { MessageContentPart } from "../domain/messages/messageContent";
import type {
  FavoriteSessionBackupEntry,
  SessionDirectoryQuery,
  SessionDirectorySnapshot,
} from "../domain/session-management";
import type {
  ThemeInteractionConfig,
  ThemeInteractionEventType,
  ThemeMediaDefinition,
  ThemeMediaSurface,
  ThemeStateValue,
} from "../domain/themes/themeInteractionContract";

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
  VoiceCapture: "voiceCapture",
  Character: "character",
  Worldbook: "worldbook",
  Settings: "settings",
  Preset: "preset",
  CharacterRender: "characterRender",
  WorkerPlugins: "workerPlugins",
  DataMigration: "dataMigration",
  LocalResources: "localResources",
  ThemeInteractions: "themeInteractions",
  Attachments: "attachments",
  AgentRuntime: "agentRuntime",
  CompatibilityRuntime: "compatibilityRuntime",
  RuntimeProfiles: "runtimeProfiles",
  ToolConnectors: "toolConnectors",
  SessionManagement: "sessionManagement",
} as const;

export interface ISessionManagementService<TSession = unknown> extends IKernelService {
  queryDirectory(query?: SessionDirectoryQuery): Promise<SessionDirectorySnapshot>;
  archiveSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  favoriteSession(sessionId: string): Promise<FavoriteSessionBackupEntry>;
  updateFavoriteBackup(backupId: string): Promise<FavoriteSessionBackupEntry>;
  removeFavoriteBackup(backupId: string): Promise<void>;
  restoreFavoriteBackup(backupId: string): Promise<TSession>;
  permanentlyDeleteArchivedSession(sessionId: string): Promise<void>;
}

export interface IToolPluginRuntimeService extends IKernelService {
  reload(): Promise<void>;
  getEnabledToolNames(profileId: string): string[];
  extendComposition(snapshot: AgentCompositionSnapshot): AgentCompositionSnapshot;
  getDiagnostics(): ToolPluginRuntimeDiagnostics;
  listCredentialStatus(pluginId: string): Promise<ToolPluginCredentialStatus[]>;
  setCredential(pluginId: string, credentialId: string, value: string): Promise<void>;
  deleteCredential(pluginId: string, credentialId: string): Promise<void>;
}

export interface IAgentRuntimeService extends IKernelService {
  registerDriver(definition: AgentDriverDefinition): EffectDisposer;
  registerProvider(definition: AgentProviderDefinition): EffectDisposer;
  registerTool(definition: AgentToolDefinition): EffectDisposer;
  registerMediaProcessor(definition: AgentMediaProcessorDefinition): EffectDisposer;
  listDrivers(): AgentDriverDefinition[];
  listProviders(): AgentProviderDefinition[];
  listTools(): AgentToolDefinition[];
  listMediaProcessors(): AgentMediaProcessorDefinition[];
  getProvider(providerId: string): AgentProviderDefinition;
  openHandle(options: {
    sessionId: string;
    driverId: string;
    providerId: string;
    executeLegacy: (context: AgentTurnExecutionContext) => Promise<void>;
    grantedPermissions: readonly string[];
    enabledToolNames?: readonly string[];
  }): AgentHandle;
  getDiagnostics(): {
    drivers: ReadonlyArray<{ id: string; version: string }>;
    providers: ReadonlyArray<{ id: string; version: string }>;
    tools: ReadonlyArray<{
      name: string;
      version: string;
      riskLevel: AgentToolDefinition["riskLevel"];
      policy: AgentToolDefinition["policy"];
    }>;
    mediaProcessors: ReadonlyArray<{ id: string; version: string }>;
    activeHandles: number;
  };
  listJournalBySession(sessionId: string): Promise<AgentJournalEvent[]>;
  replaceJournal(events: readonly AgentJournalEvent[]): Promise<void>;
  deleteJournalBySession(sessionId: string): Promise<void>;
  bindComposition(snapshot: AgentCompositionSnapshot): EffectDisposer;
  getCompositionSnapshot(): AgentCompositionSnapshot | null;
  listPendingToolApprovals(): AgentToolApprovalRequest[];
  subscribeToolApprovals(listener: (request: AgentToolApprovalRequest) => void): EffectDisposer;
  resolveToolApproval(approvalId: string, decision: AgentToolApprovalDecision): boolean;
  subscribeJournal(listener: (sessionId: string) => void): EffectDisposer;
}

export interface IAttachmentService extends IKernelService {
  stageFile(file: File): Promise<AttachmentMetadata>;
  listAttachments(): Promise<AttachmentMetadata[]>;
  getMetadata(id: string): Promise<AttachmentMetadata | null>;
  getBlob(id: string): Promise<Blob>;
  getObjectUrl(id: string): Promise<string>;
  reconcileReferences(references: readonly AttachmentReference[]): Promise<void>;
  patchReferences(
    references: readonly AttachmentReference[],
    removedReferenceIds?: readonly string[],
  ): Promise<void>;
  collectGarbage(cutoffTime: number): Promise<string[]>;
  exportAttachments(assetIds?: readonly string[]): Promise<AttachmentBackupRecord[]>;
  replaceAttachments(
    records: readonly AttachmentBackupRecord[],
    references?: readonly AttachmentReference[],
  ): Promise<void>;
}


export interface StreamChunk {
  content?: string;
  reasoning_content?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  __rescuedContent?: string;
  /** 错误载荷：可能是字符串或 { message: string } 结构 */
  error?: string | { message?: string };
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    /** 非流式响应中的完整消息（部分 provider 在首 chunk 返回） */
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    /** 部分 provider（如 Anthropic 兼容层）用 text 而非 delta.content */
    text?: string;
    /** 完成原因：stop / length / content_filter 等 */
    finish_reason?: string;
  }>;
}

export interface StreamParams {
  baseUrl: string;
  apiKey: string;
  chatPath?: string;
  bypassProxy?: boolean;
  disableReasoning?: boolean;
  forceBasicParams?: boolean;
  reqBody: Record<string, unknown>;
  signal?: AbortSignal;
  /** traceId：透传给 LLMService.universalFetch，关联 API 调用链日志 */
  traceId?: string;
}

export interface IChatStreamService extends IKernelService {
  streamLlmResponse(params: StreamParams): AsyncGenerator<StreamChunk, void, unknown>;
}

// 注：OutputPipelineContext 已上移到 src/services/pipeline/types.ts，
// kernel 仅保留 IPipeline<T> 泛型契约，不再反向依赖上层业务实体类型。

/**
 * 数据库服务契约。
 *
 * 泛型参数（默认 unknown）：
 * - TSession：会话实体类型（如 ChatSession）
 * - TCharacter：角色卡实体类型（如 CharacterCard）
 * - TSummary：摘要实体类型（如 SummaryCard）
 * - TMessage：消息实体类型（如 Message）
 *
 * 实现方必须显式声明所有类型参数，例如：
 *   `class DatabaseService implements IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>`
 */
export interface IDatabaseService<TSession = unknown, TCharacter = unknown, TSummary = unknown, TMessage = unknown, TSessionPatch = unknown> extends IKernelService {
  getAllSessions(): Promise<TSession[]>;
  /**
   * P0-2 基础设施：按主键单条直查会话，避免 getAllSessions() 全量反序列化。
   * 用于 MemorySummary 等仅需查找当前会话的场景。
   */
  getSessionById(id: string): Promise<TSession | null>;
  getLatestSessionByCharacter(characterId: string): Promise<TSession | null>;
  /** 使用稳定消息游标读取一个界面窗口；虚拟列表只负责渲染，不替代存储分页。 */
  getSessionMessageWindow(
    sessionId: string,
    options: { pageSize: number; beforeMessageId?: string },
  ): Promise<{ messages: TMessage[]; hasMore: boolean }>;
  getSessionPromptMessages(
    sessionId: string,
    options: { limit?: number; preserveFirstAssistant: boolean; beforeMessageId?: string },
  ): Promise<TMessage[]>;
  /** 读取指定消息之前最近的持久化变量/状态表快照，供重发恢复。 */
  getSessionStateBeforeMessage(sessionId: string, messageId: string): Promise<TSessionPatch>;
  // PERF-03: 分页加载 API，避免一次性 getAll() 阻塞主线程
  getSessionsCount(): Promise<number>;
  /** 只扫描索引键汇总每个角色的会话数，供目录统计使用。 */
  getSessionCountsByCharacter(): Promise<Record<string, number>>;
  getSessionsPaginated(page: number, pageSize: number): Promise<TSession[]>;
  /** 使用稳定 `(createdAt, id)` 游标读取会话目录页。 */
  getSessionsPage(options: {
    pageSize: number;
    before?: { createdAt: number; id: string };
  }): Promise<{ sessions: TSession[]; hasMore: boolean }>;
  runStorageDiagnostics(): Promise<{
    databaseName: string;
    version: number;
    storeNames: string[];
    recordCounts: Record<string, number>;
    writeLatencyMs: number;
    readWriteVerified: boolean;
  }>;
  updateSessionMetadata(sessionId: string, patch: TSessionPatch, signal?: AbortSignal, traceId?: string): Promise<void>;
  /**
   * 在 sessions Store 内原子追加摘要并推进最后总结位置。
   * 这是会话聚合能力，不暴露记忆词典、召回等业务专用存储细节。
   */
  appendSessionSummary(
    sessionId: string,
    summary: TSummary,
    signal?: AbortSignal
  ): Promise<TSession>;
  /** 原子更新单条摘要，保留并发追加的其他时间线节点。 */
  updateSessionSummary(
    sessionId: string,
    summary: TSummary,
    signal?: AbortSignal
  ): Promise<TSession>;
  /** 原子删除单条摘要，并按剩余时间线回退最后总结位置。 */
  deleteSessionSummary(
    sessionId: string,
    summaryId: string,
    signal?: AbortSignal
  ): Promise<TSession>;
  /**
   * 单条消息写入 messages Store（用于发送/重投场景的精准单条持久化）。
   * 元数据更新不写消息；新消息必须通过本方法显式写入。
   */
  appendSessionMessage(sessionId: string, message: TMessage, turnIndex?: number, signal?: AbortSignal, traceId?: string): Promise<void>;
  /** 原子提交一次输出流水线产生的全部消息和元数据变更。 */
  commitSessionTurn(
    sessionId: string,
    patch: TSessionPatch,
    messages: TMessage[],
    signal?: AbortSignal,
    traceId?: string
  ): Promise<void>;
  /** 原子删除会话消息并级联清理摘要与派生记忆。 */
  deleteSessionMessage(sessionId: string, messageId: string, signal?: AbortSignal): Promise<TSession>;
  /** 原子编辑会话消息，并失效该轮次之后的摘要、状态快照与派生记忆。 */
  updateSessionMessage(
    sessionId: string,
    message: TMessage,
    patch: TSessionPatch,
    signal?: AbortSignal,
  ): Promise<TSession>;
  /** 原子替换重发分支：会话元数据、旧消息删除和新消息写入同事务提交。 */
  replaceSessionBranch(
    session: TSession,
    removedMessageIds: string[],
    newMessages: TMessage[],
    signal?: AbortSignal
  ): Promise<void>;
  deleteSession(id: string, signal?: AbortSignal): Promise<void>;
  /**
   * 批量写入会话（备份恢复 / 跨设备同步场景）。
   * 跨 sessions+messages Store 事务，用于一次性导入完整对话历史。
   */
  replaceCompleteSessions(sessionsList: TSession[], signal?: AbortSignal): Promise<void>;
  createNewSession(character: TCharacter, starterMessage?: string, initialSuggestions?: string[]): Promise<TSession>;
  createEmptyBranch(
    character: TCharacter,
    title: string,
    parentSessionId?: string,
    signal?: AbortSignal,
  ): Promise<TSession>;
  createBacktrackBranch(sourceSession: TSession, title: string, msgId: string): Promise<TSession>;
  createBacktrackFromTimeline(sourceSession: TSession, title: string, summaryId: string): Promise<TSession>;
  /**
   * P0-4 / P1-4 基础设施：按主键单条直查角色卡，避免 getAllCharacters() 全量反序列化。
   */
  getCharacterById(id: string): Promise<TCharacter | null>;
}

export interface LLMProxyRequestConfig {
  /** 连接配置类型；保留给代理与连接检测识别 Provider 方言。 */
  type?: string;
  baseUrl: string;
  apiKey: string;
  chatPath?: string;
  modelsPath?: string;
  modelName?: string;
  bypassProxy?: boolean;
  disableReasoning?: boolean;
  forceBasicParams?: boolean;
  /** 模型列表、连接检测等非对话请求可以不携带请求体。 */
  reqBody?: Record<string, unknown>;
}

export interface ILLMService extends IKernelService {
  universalFetch(
    type: string,
    config: LLMProxyRequestConfig,
    signal?: AbortSignal,
    traceId?: string
  ): Promise<Response>;
  isClientMode(): boolean;
  sendCatbotRequest(
    content: string,
    history: unknown[],
    clientContext?: unknown,
    traceId?: string
  ): Promise<{ reply: string; expression: string }>;
}

/**
 * 提示词服务契约。
 *
 * 泛型参数（默认 unknown）：
 * - TCharacter：角色卡实体类型（如 CharacterCard）
 * - TSession：会话实体类型（如 ChatSession）
 * - TSettings：用户设置实体类型（如 UserSettings）
 * - TLorebook：世界书条目实体类型（如 LorebookEntry）
 *
 * 实现方必须显式声明所有类型参数，例如：
 *   `class PromptService implements IPromptService<CharacterCard, ChatSession, UserSettings, LorebookEntry>`
 */
export interface IPromptService<TCharacter = unknown, TSession = unknown, TSettings = unknown, TLorebook = unknown> extends IKernelService {
  assemblePrompt(params: {
    character: TCharacter;
    chat: TSession;
    userInput: string;
    settings: TSettings;
    globalLorebook: TLorebook[];
    recalledMemories?: unknown[];
    signal?: AbortSignal;
    /** traceId：用于关联一次用户操作的提示词编译日志与遥测事件 */
    traceId?: string;
  }): {
    version: 1;
    systemInstruction: string;
    history: Array<{ role: "model" | "user" | "assistant"; name?: string; content: string }>;
    dynamicInstruction: string;
    userInput?: string;
    messages: Array<{ role: "system" | "user" | "assistant"; name?: string; content: string }>;
    diagnostics: Array<{
      level: "info" | "warning" | "error";
      code: string;
      message: string;
      blockId?: string;
      detail?: string;
    }>;
    traces: PromptCompositionTrace[];
    budget?: PromptCompositionBudgetReport;
    stopSequences?: string[];
    requestShaping: {
      enabled: boolean;
      originalMessageCount: number;
      finalMessageCount: number;
      mergedMessageCount: number;
      squashedSystemMessageCount: number;
      assistantPrefillAdded: boolean;
      stopSequences: string[];
    };
  };
  cleanNameForApi(name: string | undefined, fallback: string): string | undefined;
  estimateTokens(text: string): number;
  sanitizeName(name: string): string;
  getTriggeredLorebookEntries(
    messages: ReadonlyArray<{ content: string; role?: string; sender?: string }>,
    userInput: string,
    entries: TLorebook[],
    maxRecursionDepth?: number,
    conditionContext?: {
      variables?: Record<string, unknown>;
      session?: Record<string, unknown>;
    }
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
  reportUsage(action?: string, extraData?: Record<string, unknown>): void;
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
    playerName?: string,
    traceId?: string
  ): void;
  reportImmediate(action: string, extraData?: Record<string, unknown>): Promise<void>;
  reportColdStartReady(): Promise<void>;
  reportChatLoadTime(durationMs: number): void;
  reportDbQueueTimeout(queueDelayMs: number, queueLength: number): void;
  reportZodValidationError(errorDetail: string, path: string, inputVal: unknown): void;
}

/**
 * 脚本服务契约。
 *
 * 泛型参数（默认 unknown）：
 * - TCharacter：角色卡实体类型（如 CharacterCard）
 * - TSession：会话实体类型（如 ChatSession）
 *
 * 实现方必须显式声明所有类型参数，例如：
 *   `class ScriptService implements IScriptService<CharacterCard, ChatSession>`
 */
export interface IScriptService<TCharacter = unknown, TSession = unknown> extends IKernelService {
  initializeMvuFromCharacter(character: TCharacter): Record<string, unknown>;
  parseMvuMessage(messageContent: string, currentVariables: Record<string, unknown>, signal?: AbortSignal): Record<string, unknown>;
  executeMvuScript(session: TSession, messageContent: string, signal?: AbortSignal): Promise<TSession>;
  registerBridge(bridge: unknown): void;
}

/**
 * 多消息队列服务契约。
 *
 * 泛型参数（默认 unknown）：TSession 为会话实体类型（如 ChatSession）。
 * 实现方必须显式声明类型参数，例如：
 *   `class MultiMessageService implements IMultiMessageService<ChatSession>`
 */
export interface IMultiMessageService<TSession = unknown> extends IKernelService {
  queueUserMessage(
    session: TSession,
    text: string,
    additionalParts?: readonly MessageContentPart[],
  ): Promise<TSession>;
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
  generateImage(prompt: string, config: unknown, signal?: AbortSignal): Promise<string>;
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

/** 本地界面媒体资源服务：大字段独立存储，向主题与 UI 插件提供受控 Blob URL。 */
export interface ILocalResourceService extends IKernelService {
  listResources(): Promise<LocalResourceMetadata[]>;
  importFile(file: File): Promise<LocalResourceMetadata>;
  deleteResource(id: string): Promise<void>;
  getObjectUrl(id: string): Promise<string>;
  getResourceReference(id: string): string;
  resolveResourceReference(reference: string): Promise<string>;
  getCssReference(id: string): string;
}

export type ThemeOrientation = "portrait" | "landscape";

export interface ThemeInteractionEvent {
  type: ThemeInteractionEventType;
  target?: string;
  tabId?: string;
  orientation?: ThemeOrientation;
  mediaId?: string;
}

export interface ThemeInteractionEnvironment {
  mediaEnabled: boolean;
  orientation: ThemeOrientation;
  activeTab: string;
  appVisible: boolean;
  reducedMotion: boolean;
}

export interface ThemeMediaRuntimeState {
  definition: ThemeMediaDefinition;
  status: "stopped" | "playing" | "paused";
  volume: number;
  muted: boolean;
}

export interface ThemeSurfaceRuntimeState {
  visible: boolean;
  mediaId: string;
}

export interface ThemeInteractionSnapshot {
  revision: number;
  themeId: string | null;
  mediaEnabled: boolean;
  media: Record<string, ThemeMediaRuntimeState>;
  surfaces: Partial<Record<ThemeMediaSurface, ThemeSurfaceRuntimeState>>;
  state: Record<string, ThemeStateValue>;
  styleStates: string[];
}

/** 主题 1.1 的有限状态机；只编排声明式动作，不接触 DOM、存储或网络。 */
export interface IThemeInteractionService extends IKernelService {
  activateTheme(themeId: string, config: ThemeInteractionConfig): void;
  deactivateTheme(): void;
  setEnvironment(patch: Partial<ThemeInteractionEnvironment>): void;
  dispatch(event: ThemeInteractionEvent): void;
  getSnapshot(): ThemeInteractionSnapshot;
  subscribe(listener: () => void): () => void;
}

/**
 * 记忆系统服务接口（物理分轨存储 + 分层认知记忆架构）。
 * 整合底层存储 (Storage)、实体/事件抽取 (Extractor)、标签召回 (Recall)、状态表 (StateTable) 及剧情摘要 (Summary)。
 *
 * 泛型参数（默认 unknown）：
 * - TStorage：存储层子模块类型（如 MemoryStorage）
 * - TExtractor：抽取器子模块类型（如 MemoryExtractor）
 * - TRecall：召回器子模块类型（如 MemoryRecall）
 * - TStateTable：状态表子模块类型（如 MemoryStateTable）
 * - TSummary：摘要子模块类型（如 MemorySummary）
 *
 * 实现方必须显式声明所有类型参数，例如：
 *   `class MemoryService implements IMemoryService<MemoryStorage, MemoryExtractor, MemoryRecall, MemoryStateTable, MemorySummary>`
 */
export interface IMemoryService<
  TStorage = unknown,
  TExtractor = unknown,
  TRecall = unknown,
  TStateTable = unknown,
  TSummary = unknown
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
   * 获取摘要子模块。
   * 阶段 C 装配，供 output 中间件触发剧情时间线摘要。
   */
  getSummary(): TSummary;
}

export interface ITtsService extends IKernelService {
  speak(text: string, config: unknown, signal?: AbortSignal): Promise<void>;
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
  transcribeFile(
    blob: Blob,
    fileName: string,
    config: AsrConfig,
    signal?: AbortSignal,
  ): Promise<string>;
}

export interface VoiceCaptureOptions {
  readonly maxDurationMs?: number;
  readonly onLimitReached?: () => void;
}

/** 只负责采集供模型原生理解的 WAV 语音，不承担 ASR 或音频附件选择。 */
export interface IVoiceCaptureService extends IKernelService {
  isCapturing(): boolean;
  startCapture(options?: VoiceCaptureOptions): Promise<void>;
  stopCapture(): Promise<File>;
  cancelCapture(): Promise<void>;
}

/**
 * 角色卡服务契约。
 *
 * 泛型参数（默认 unknown）：TCharacter 为角色卡实体类型（如 CharacterCard）。
 * 实现方必须显式声明类型参数，例如：
 *   `class CharacterService implements ICharacterService<CharacterCard>`
 */
export interface ICharacterService<TCharacter = unknown> extends IKernelService {
  getAllCharacters(): Promise<TCharacter[]>;
  getCharacterCatalog(): Promise<TCharacter[]>;
  getCharacterById(id: string): Promise<TCharacter | null>;
  saveCharacter(character: TCharacter): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  bulkSaveCharacters(charactersList: TCharacter[]): Promise<void>;
  getStoredDefaultCharactersInitializedFlag(): Promise<boolean>;
  saveStoredDefaultCharactersInitializedFlag(initialized: boolean): Promise<void>;
}

/**
 * 世界书服务契约。
 *
 * 泛型参数（默认 unknown）：
 * - TLorebook：世界书条目实体类型（如 LorebookEntry）
 * - TWorldbook：自定义世界书实体类型（如 CustomWorldbook）
 *
 * 实现方必须显式声明所有类型参数，例如：
 *   `class WorldbookService implements IWorldbookService<LorebookEntry, CustomWorldbook>`
 */
export interface IWorldbookService<TLorebook = unknown, TWorldbook = unknown> extends IKernelService {
  getGlobalLorebook(): Promise<TLorebook[]>;
  saveGlobalLorebook(entries: TLorebook[]): Promise<void>;
  getCustomWorldbooks(): Promise<Record<string, TWorldbook>>;
  saveCustomWorldbooks(worldbooks: Record<string, TWorldbook>): Promise<void>;
}

/**
 * 设置服务契约。
 *
 * 泛型参数（默认 unknown）：TSettings 为用户设置实体类型（如 UserSettings）。
 * 实现方必须显式声明类型参数，例如：
 *   `class SettingsService implements ISettingsService<UserSettings>`
 */
export interface ISettingsService<TSettings = unknown, TUsageMetrics = unknown> extends IKernelService {
  getStoredSettings(): Promise<TSettings | null>;
  saveStoredSettings(settings: TSettings): Promise<void>;
  getUsageMetrics(): Promise<TUsageMetrics | null>;
  saveUsageMetrics(metrics: TUsageMetrics): Promise<void>;
}

/** 统一备份创建与本地数据原子覆盖恢复。 */
export interface IDataMigrationService<TSettings = unknown, TPayload = unknown> extends IKernelService {
  createBackupPayload(
    settings: TSettings,
    isEncrypted: boolean,
    backupDate?: string,
  ): Promise<TPayload>;
  replaceFromBackup(payload: TPayload, signal?: AbortSignal): Promise<void>;
}

/**
 * 预设服务契约。
 *
 * 泛型参数（默认 unknown）：TPreset 为预设包实体类型（如 SavedPresetBundle）。
 * 实现方必须显式声明类型参数，例如：
 *   `class PresetService implements IPresetService<SavedPresetBundle>`
 */
export interface IPresetService<TPreset = unknown> extends IKernelService {
  getStoredSavedPresets(): Promise<TPreset[] | null>;
  saveStoredSavedPresets(presets: TPreset[]): Promise<void>;
}
