/**
 * MemoryService 内部类型定义
 *
 * 仅在本服务子模块内部使用，不对外暴露。
 * 对外公共契约由 src/kernel/types.ts 的 IMemoryService 接口承担。
 */

/** 记忆领域持久化端口的 Kernel 注册令牌，由端口所有方定义。 */
export const MEMORY_PERSISTENCE_SERVICE = "memoryPersistence";

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system';

/** 标签抽取来源（三级降级标记） */
export type ExtractSource = 'llm' | 'dict' | 'none';

/** 实体类型 */
export type EntityType = 'character' | 'location' | 'item' | 'organization' | 'concept';

/**
 * messages Store 记录结构。
 * 存储所有原始对话消息，按 sessionId 隔离，永久保留。
 */
export interface MessageRecord {
  /** 消息唯一 ID（uuid 或基于时间戳的随机串） */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色 */
  role: MessageRole;
  /** 原始消息内容（剥离 <memory> 标签后展示给用户的文本） */
  content: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 在会话中的轮次序号（从 0 开始） */
  turnIndex: number;
  /** 抽取的实体标签（如 ["老张", "梅子酒", "酒馆"]） */
  tags: string[];
  /** 标签来源：llm=主对话顺便抽取, dict=词典匹配, none=未抽取 */
  extractSource: ExtractSource;
  /** 元数据 */
  metadata?: {
    modelUsed?: string;
    tokenCount?: number;
  };
}

/**
 * memory_dict Store 记录结构。
 * 会话级自动学习词典，记录从对话中涌现的实体。
 */
export interface MemoryDictEntry {
  /** 复合键 `${sessionId}:${entity}` */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 实体名（如 "老张"） */
  entity: string;
  /** 别名（如 ["张老板", "酒馆老板"]） */
  aliases: string[];
  /** 实体类型 */
  type: EntityType;
  /** 首次出现的消息 ID */
  firstSeenMsgId: string;
  /** 首次出现的轮次 */
  firstSeenTurn: number;
  /** 出现次数（用于热度排序） */
  count: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

export type MemoryFragmentStatus = 'active' | 'superseded' | 'invalid';

/**
 * 从原始消息中提炼出的事件型长期记忆。
 * 原始消息仍永久保留；片段只承载可召回、可纠错的简洁事实及其来源链。
 */
export interface MemoryFragment {
  id: string;
  sessionId: string;
  content: string;
  participants: string[];
  tags: string[];
  sourceMessageIds: string[];
  sourceRole: MessageRole;
  sourceTurnStart: number;
  sourceTurnEnd: number;
  status: MemoryFragmentStatus;
  supersedesId?: string;
  supersededById?: string;
  importance: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/**
 * 记忆领域持久化端口。
 *
 * 该契约由记忆领域定义，IndexedDB 等物理存储只能在基础设施层实现，
 * 防止业务子模块直接依赖 localDB 或把记忆专用 CRUD 反向塞入通用数据库底座。
 */
export interface MemoryPersistencePort {
  appendMessage(message: MessageRecord, signal?: AbortSignal): Promise<void>;
  updateMessageExtraction(
    id: string,
    tags: string[],
    extractSource: string,
    metadata?: Record<string, any>,
    signal?: AbortSignal
  ): Promise<void>;
  getMessageById(id: string): Promise<MessageRecord | null>;
  getMessagesBySession(
    sessionId: string,
    options?: { limit?: number; offset?: number; descending?: boolean }
  ): Promise<MessageRecord[]>;
  getMessagesByTag(
    sessionId: string,
    tags: string[],
    limit?: number
  ): Promise<MessageRecord[]>;
  deleteMessagesBySession(sessionId: string, signal?: AbortSignal): Promise<void>;
  upsertDictEntry(entry: {
    sessionId: string;
    entity: string;
    aliases?: string[];
    type?: EntityType;
    firstSeenMsgId: string;
    firstSeenTurn: number;
    count?: number;
  }, signal?: AbortSignal): Promise<boolean>;
  getDictEntryById(id: string): Promise<MemoryDictEntry | null>;
  getDictBySession(sessionId: string): Promise<MemoryDictEntry[]>;
  deleteDictBySession(sessionId: string, signal?: AbortSignal): Promise<void>;
  deleteDictEntryById(id: string, signal?: AbortSignal): Promise<void>;
  upsertFragment(fragment: MemoryFragment, signal?: AbortSignal): Promise<void>;
  getFragmentById(id: string): Promise<MemoryFragment | null>;
  getFragmentsBySession(sessionId: string): Promise<MemoryFragment[]>;
  getFragmentsByTags(sessionId: string, tags: string[], limit?: number): Promise<MemoryFragment[]>;
  supersedeFragment(
    originalId: string,
    replacement: MemoryFragment,
    signal?: AbortSignal
  ): Promise<void>;
  updateFragmentStatus(
    id: string,
    status: MemoryFragmentStatus,
    signal?: AbortSignal
  ): Promise<void>;
  deleteFragmentsBySession(sessionId: string, signal?: AbortSignal): Promise<void>;
}

/** LLM 抽取结果（L0 阶段产出） */
export interface MemoryExtraction {
  entities: Array<{
    name: string;
    type: EntityType;
    first_seen: boolean;
  }>;
  events: Array<{
    summary: string;
    participants: string[];
  }>;
}

/** 召回结果项 */
export interface RecalledMessage {
  /** 统一记忆 ID；事件片段为 fragment.id，原始消息为 message.id。 */
  memoryId: string;
  messageId: string;
  turnIndex: number;
  role: MessageRole;
  content: string;
  /** 命中的查询标签数（用于排序） */
  hitCount: number;
  /** 命中的具体标签 */
  hitTags: string[];
  /** 评分（hitCount × 时间衰减） */
  score: number;
  /** 召回内容类型与理由，供“本轮记忆包”审计。 */
  kind: 'event' | 'message';
  reason: 'tag' | 'pin' | 'weak';
  sourceMessageIds: string[];
  importance?: number;
  confidence?: number;
}

export interface MemoryPacketSourceAudit {
  key: 'memory.summaries' | 'memory.recalled' | 'memory.tables';
  label: string;
  included: boolean;
  count: number;
  characters: number;
  estimatedTokens: number;
  dropped?: boolean;
}

/** 最近一次真正参与 Prompt 组装的记忆包快照，只存在于运行时。 */
export interface MemoryAuditSnapshot {
  sessionId: string;
  query: string;
  createdAt: number;
  recalled: RecalledMessage[];
  sources: MemoryPacketSourceAudit[];
  totalEstimatedTokens: number;
}

/** 流式解析器单次输出 */
export interface StreamParserOutput {
  /** 应展示给用户的文本（已剥离 <memory> 标签） */
  displayText: string;
  /** 完整的 <memory> 内容（仅在标签闭合时返回） */
  memoryContent?: string;
}

/** 模型能力元数据 */
export interface ModelCapabilities {
  supportsTopK: boolean;
  supportsTopP: boolean;
  supportsTemperature: boolean;
  supportsJsonSchema: boolean;
  supportsFunctionCalling: boolean;
  supportsStream: boolean;
  supportsSystemPrompt: boolean;
  supportsMinP?: boolean;
  supportsRepetitionPenalty?: boolean;
  supportsStreamOptions?: boolean;
  contextWindow?: number;
  preferredFormat?: 'xml' | 'markdown';
}

/** LLM 调用参数（防腐层入口） */
export interface LLMParams {
  top_k?: number;
  top_p?: number;
  temperature?: number;
  response_format?: any;
  functions?: any;
  [key: string]: any;
}

/**
 * 构造 memory_dict Store 的复合键。
 * 格式：`${sessionId}:${entity}`
 */
export function buildDictId(sessionId: string, entity: string): string {
  return `${sessionId}:${entity}`;
}
