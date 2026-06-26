/**
 * MemoryExtractor - 记忆抽取器（L0 LLM 抽取 + L1 词典匹配 + L2 仅存原文）
 *
 * 物理职责：
 *   1. L0：校验 LLM 在 <memory> 标签内输出的 JSON 抽取结果（手写校验器替代 zod，零依赖）
 *   2. L1：用 RegExp 批量匹配词典实体（替代 aho-corasick，词典 < 2000 条时性能差异 < 10ms）
 *   3. L2：L0/L1 均未命中时仅存原文，tags 为空数组
 *   4. 异步抽取队列：节流（上一轮未完成则跳过）、防堆积（队列 > 3 丢弃最旧）
 *   5. 抽取成功后自动更新 memory_dict Store（新实体入库，已存在实体 count++）
 *
 * 设计契约：
 *   - 零运行时依赖（不引入 zod / aho-corasick，保持移动端 APK 轻量）
 *   - 所有异步任务绑定 AbortSignal，destroy 时彻底回收
 *   - 抽取失败不阻塞主对话流，仅 console.error 记录
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第七章
 */

import type {
  ExtractSource,
  EntityType,
  MemoryDictEntry,
  MemoryExtraction,
  MessageRole,
} from './types';
import type { MemoryStorage } from './MemoryStorage';

// ===== 常量 =====

/** 合法实体类型集合 */
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'character',
  'location',
  'item',
  'organization',
  'concept',
]);

/** 单轮最多抽取的实体数（防 LLM 滥抽） */
const MAX_ENTITIES_PER_TURN = 20;

/** 单轮最多抽取的事件数 */
const MAX_EVENTS_PER_TURN = 10;

/** 实体名最大长度 */
const MAX_ENTITY_NAME_LEN = 50;

/** 事件摘要最大长度 */
const MAX_EVENT_SUMMARY_LEN = 50;

/** 抽取队列最大深度（超过则丢弃最旧） */
const MAX_QUEUE_SIZE = 3;

// ===== 类型 =====

/** 抽取任务参数 */
export interface ExtractionTask {
  /** 消息唯一 ID */
  msgId: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色 */
  role: MessageRole;
  /** 原始消息内容（已剥离 <memory> 标签） */
  message: string;
  /** 在会话中的轮次序号 */
  turnIndex: number;
  /** 从流式解析器获得的 <memory> 标签内容（L0 抽取输入，可选） */
  memoryContent?: string;
}

/** 抽取结果 */
export interface ExtractionResult {
  tags: string[];
  extractSource: ExtractSource;
  extraction?: MemoryExtraction;
}

// ===== 纯函数：L0 校验器（手写，替代 zod） =====

/**
 * 校验 LLM 输出的 <memory> JSON 内容。
 * 校验规则与架构文档 7.2.4 节 MemoryExtractionSchema 等价：
 *   - 必须是合法 JSON 对象
 *   - entities: 数组，每项 { name: string(1-50), type: EntityType, first_seen: boolean }，最多 20 个
 *   - events: 数组，每项 { summary: string(1-50), participants: string[] }，最多 10 个
 *
 * @returns 校验通过返回 MemoryExtraction，失败返回 null（触发降级到 L1）
 */
export function validateExtraction(content: string): MemoryExtraction | null {
  if (!content || typeof content !== 'string') return null;

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const entities = validateEntities(parsed.entities);
  if (entities === null) return null;

  const events = validateEvents(parsed.events);
  if (events === null) return null;

  return { entities, events };
}

function validateEntities(raw: any): MemoryExtraction['entities'] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_ENTITIES_PER_TURN) return null;

  const result: MemoryExtraction['entities'] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

    const name = item.name;
    if (typeof name !== 'string' || name.length < 1 || name.length > MAX_ENTITY_NAME_LEN) {
      return null;
    }

    const type = item.type;
    if (typeof type !== 'string' || !VALID_ENTITY_TYPES.has(type)) return null;

    const first_seen = item.first_seen;
    if (typeof first_seen !== 'boolean') return null;

    result.push({ name, type: type as EntityType, first_seen });
  }
  return result;
}

function validateEvents(raw: any): MemoryExtraction['events'] | null {
  if (raw === undefined) return []; // events 可选，缺省为空数组
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_EVENTS_PER_TURN) return null;

  const result: MemoryExtraction['events'] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

    const summary = item.summary;
    if (typeof summary !== 'string' || summary.length < 1 || summary.length > MAX_EVENT_SUMMARY_LEN) {
      return null;
    }

    const participants = item.participants;
    if (participants === undefined) {
      result.push({ summary, participants: [] });
      continue;
    }
    if (!Array.isArray(participants)) return null;
    for (const p of participants) {
      if (typeof p !== 'string') return null;
    }
    result.push({ summary, participants });
  }
  return result;
}

// ===== 纯函数：L1 词典匹配（RegExp 批量匹配，替代 AC 自动机） =====

/**
 * 转义正则特殊字符。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 用词典批量匹配消息文本，返回命中的实体名列表。
 *
 * 实现说明：
 *   - 收集所有实体名 + 别名，构建 term → entity 映射
 *   - 按长度降序排序（长串优先，避免短串截断长实体名）
 *   - 构建单次 RegExp 全局匹配，O(M+Z) 级别（M=消息长度，Z=命中数）
 *   - 词典 < 2000 条时性能 < 5ms，与 AC 自动机差异可忽略
 *
 * @param message 消息文本
 * @param dict 词典条目列表
 * @returns 命中的实体名列表（去重）
 */
export function extractByDict(message: string, dict: MemoryDictEntry[]): string[] {
  if (!message || dict.length === 0) return [];

  // 构建 term(小写) → entity(原始) 映射
  const termToEntity = new Map<string, string>();
  for (const entry of dict) {
    if (entry.entity && entry.entity.length > 0) {
      termToEntity.set(entry.entity.toLowerCase(), entry.entity);
    }
    if (Array.isArray(entry.aliases)) {
      for (const alias of entry.aliases) {
        if (alias && alias.length > 0) {
          termToEntity.set(alias.toLowerCase(), entry.entity);
        }
      }
    }
  }

  if (termToEntity.size === 0) return [];

  // 按长度降序排序，避免短串截断长实体名（如"老张"截断"老张三"）
  const terms = Array.from(termToEntity.keys()).sort((a, b) => b.length - a.length);

  // 构建正则：(term1|term2|...)，全局 + 大小写不敏感
  const pattern = terms.map(escapeRegExp).join('|');
  const regex = new RegExp(pattern, 'gi');

  const hitEntities = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    const term = match[0].toLowerCase();
    const entity = termToEntity.get(term);
    if (entity) hitEntities.add(entity);
    // 防 lastIndex 卡死（理论上不会，因为所有 term 非空）
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }

  return Array.from(hitEntities);
}

// ===== MemoryExtractor 类 =====

export class MemoryExtractor {
  private storage: MemoryStorage;
  private abortController: AbortController | null = null;

  /** 抽取任务队列 */
  private queue: ExtractionTask[] = [];
  /** 是否正在处理队列 */
  private processing = false;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * 初始化抽取器。
   * 绑定 AbortSignal，供内核销毁时中止进行中的异步抽取任务。
   */
  init(signal?: AbortSignal): void {
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
  }

  /**
   * 销毁抽取器。
   * 中止进行中的异步任务，清空队列。
   *
   * 注意：不将 abortController 置 null，而是保留已 aborted 的实例。
   * 这样后续所有 signal 检查（scheduleExtraction / processQueue / processExtraction）
   * 都能正确识别已销毁状态，避免销毁后调度被错误处理。
   * 下次 init() 会创建新的 AbortController 覆盖此实例。
   */
  destroy(signal?: AbortSignal): void {
    if (signal) {
      if (signal.aborted) this.abortController?.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
    this.abortController?.abort();
    this.queue = [];
    this.processing = false;
  }

  /**
   * 调度异步抽取任务。
   * - 节流：上一轮未完成时入队等待（不跳过，保证最终一致性）
   * - 防堆积：队列 > MAX_QUEUE_SIZE 时丢弃最旧任务
   * - 不阻塞调用方（fire-and-forget）
   */
  scheduleExtraction(task: ExtractionTask): void {
    if (this.abortController?.signal.aborted) return;

    // 队列满则丢弃最旧
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
    this.queue.push(task);

    // 触发队列处理（异步，不等待）
    this.processQueue().catch((e) => {
      console.error('[MemoryExtractor] Queue processing failed:', e);
    });
  }

  /**
   * 同步执行三级降级抽取（供测试与中间件直接调用）。
   *
   * @param task 抽取任务
   * @returns 抽取结果（tags + extractSource + 可选的 extraction）
   */
  async extract(task: ExtractionTask): Promise<ExtractionResult> {
    return this.processExtraction(task);
  }

  /**
   * 同步词典匹配（供 MemoryRecall 调用，提取查询标签）。
   */
  async extractTagsByDict(sessionId: string, message: string): Promise<string[]> {
    const dict = await this.storage.getDictBySession(sessionId);
    return extractByDict(message, dict);
  }

  // ===== 内部方法 =====

  /** 处理队列中的抽取任务（串行） */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      if (this.abortController?.signal.aborted) break;

      const task = this.queue.shift()!;
      try {
        await this.processExtraction(task);
      } catch (e) {
        console.error('[MemoryExtractor] Extraction failed for task:', task.msgId, e);
      }
    }

    this.processing = false;
  }

  /**
   * 三级降级抽取主流程。
   *
   * L0: memoryContent 存在 → validateExtraction 校验
   *     ├─ 校验通过 → tags = entities.name, source = 'llm', 更新词典
   *     └─ 校验失败 → 降级到 L1
   * L1: 加载会话词典 → extractByDict 匹配
   *     ├─ 命中 → tags = hitEntities, source = 'dict'
   *     └─ 无命中 → 降级到 L2
   * L2: tags = [], source = 'none'
   *
   * 最终将消息写入 messages Store。
   */
  private async processExtraction(task: ExtractionTask): Promise<ExtractionResult> {
    const signal = this.abortController?.signal;
    let tags: string[];
    let extractSource: ExtractSource;
    let extraction: MemoryExtraction | undefined;

    // L0: LLM 抽取
    if (task.memoryContent) {
      const parsed = validateExtraction(task.memoryContent);
      if (parsed && parsed.entities.length > 0) {
        tags = parsed.entities.map((e) => e.name);
        extractSource = 'llm';
        extraction = parsed;
        // 更新 memory_dict Store
        if (signal?.aborted) return { tags, extractSource, extraction };
        await this.updateDictFromExtraction(task, parsed);
      } else {
        // L0 失败，降级到 L1
        const result = await this.tryDictMatch(task);
        tags = result.tags;
        extractSource = result.source;
      }
    } else {
      // 无 LLM 内容，直接 L1
      const result = await this.tryDictMatch(task);
      tags = result.tags;
      extractSource = result.source;
    }

    // 写入 messages Store
    if (signal?.aborted) return { tags, extractSource, extraction };

    await this.storage.appendMessage({
      id: task.msgId,
      sessionId: task.sessionId,
      role: task.role,
      content: task.message,
      createdAt: Date.now(),
      turnIndex: task.turnIndex,
      tags,
      extractSource,
      metadata: extraction
        ? { modelUsed: undefined }
        : undefined,
    });

    return { tags, extractSource, extraction };
  }

  /**
   * L1 词典匹配降级。
   *
   * 命中时同步更新词典 count（实体再次出现是强信号），但不传 type：
   * L1 无法判定实体类型，保留 existing.type 避免 L0 抽取的类型被污染。
   * （extractByDict 仅返回词典中已存在的实体名，所以一定走 upsertDictEntry 的更新分支）
   */
  private async tryDictMatch(
    task: ExtractionTask
  ): Promise<{ tags: string[]; source: ExtractSource }> {
    if (this.abortController?.signal.aborted) {
      return { tags: [], source: 'none' };
    }
    const dict = await this.storage.getDictBySession(task.sessionId);
    const tags = extractByDict(task.message, dict);
    if (tags.length === 0) {
      return { tags, source: 'none' };
    }
    // L1 命中：更新词典 count（实体再次出现是强信号）
    for (const entity of tags) {
      if (this.abortController?.signal.aborted) break;
      await this.storage.upsertDictEntry(task.sessionId, entity, {
        firstSeenMsgId: task.msgId,
        firstSeenTurn: task.turnIndex,
        aliases: [],
      });
    }
    return { tags, source: 'dict' };
  }

  /**
   * 将 L0 抽取结果更新到 memory_dict Store。
   * - 新实体：插入完整记录
   * - 已存在实体：count++（由 upsertDictEntry 内部处理）
   */
  private async updateDictFromExtraction(
    task: ExtractionTask,
    extraction: MemoryExtraction
  ): Promise<void> {
    for (const entity of extraction.entities) {
      if (this.abortController?.signal.aborted) break;
      await this.storage.upsertDictEntry(task.sessionId, entity.name, {
        type: entity.type,
        firstSeenMsgId: task.msgId,
        firstSeenTurn: task.turnIndex,
        aliases: [],
      });
    }
  }
}
