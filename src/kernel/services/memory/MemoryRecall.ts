/**
 * MemoryRecall - 记忆召回器（标签倒排索引 + 时间衰减打分）
 *
 * 物理职责：
 *   1. 从当前消息提取查询标签（复用 extractByDict 词典匹配）
 *   2. 按标签查 messages Store 的 tags 多值索引（倒排召回候选集）
 *   3. 候选打分：hitCount × (1 / (1 + ageInTurns / 50))，命中标签越多越新得分越高
 *   4. 排除最近 N 轮（避免与 recentTurns 上下文重复）
 *   5. 取 top-K 返回
 *
 * 设计契约：
 *   - 纯查询，不写入任何数据
 *   - 无异步资源占用（destroy 无需处理）
 *   - < 10k 消息时召回延迟 < 20ms，不阻塞主对话流
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第八章
 */

import type { MessageRecord, MessageRole, RecalledMessage } from './types';
import type { MemoryStorage } from './MemoryStorage';
import { extractByDict } from './MemoryExtractor';
import { getSessionById } from "../../../utils/localDB";

// ===== 常量 =====

/** 默认召回条数 */
const DEFAULT_TOP_K = 3;

/** 默认排除最近 N 轮（避免与 recentTurns 上下文重复） */
const DEFAULT_EXCLUDE_RECENT_N = 5;

/** 时间衰减半衰期（轮次），ageInTurns = 50 时衰减因子 = 0.5 */
const DECAY_HALF_LIFE_TURNS = 50;

/** 召回候选倍率（候选池 = topK × 倍率，先粗召回再精排） */
const CANDIDATE_MULTIPLIER = 5;

// ===== 类型 =====

/** 召回选项 */
export interface RecallOptions {
  /** 召回条数，默认 3 */
  topK?: number;
  /** 排除最近 N 轮消息，默认 5 */
  excludeRecentN?: number;
  /**
   * 当前轮次序号（用于计算时间衰减与排除最近 N 轮）。
   * 未传入时自动从 messages Store 推断最后一条消息的 turnIndex + 1。
   */
  currentTurnIndex?: number;
}

// ===== MemoryRecall 类 =====

export class MemoryRecall {
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * 召回相关历史片段（主入口）。
   *
   * 流程：
   *   1. 加载会话词典，用 extractByDict 从当前消息提取查询标签
   *   2. 无查询标签则返回空数组（不召回）
   *   3. 按标签查倒排索引获取候选集
   *   4. 打分 + 排除最近 N 轮 + 取 top-K
   *
   * @param sessionId 会话 ID
   * @param currentMessage 当前消息文本
   * @param options 召回选项
   */
  async recall(
    sessionId: string,
    currentMessage: string,
    options?: RecallOptions
  ): Promise<RecalledMessage[]> {
    // 1. 提取查询标签
    const dict = await this.storage.getDictBySession(sessionId);
    const queryTags = extractByDict(currentMessage, dict);

    // 强力 Pin 状态支持：哪怕没有匹配到任何查询标签，若用户有 Pin 的消息，依然需要召回它们
    let sessionObj: any = null;
    try {
      if (typeof window !== 'undefined' && ((window as any).indexedDB || (window as any).shimIndexedDB)) {
        sessionObj = await getSessionById(sessionId);
      }
    } catch (err) {
      console.warn("[MemoryRecall] Failed to fetch session for Pin in recall:", err);
    }
    const pinnedIds = sessionObj?.pinnedMessageIds || [];

    if (queryTags.length === 0 && pinnedIds.length === 0) {
      return []; // 无查询标签且无 Pinned 消息，不召回
    }

    // 2. 按标签召回
    return this.recallByTags(sessionId, queryTags, options);
  }

  /**
   * 直接按标签召回（跳过查询标签提取步骤）。
   *
   * @param sessionId 会话 ID
   * @param tags 查询标签列表
   * @param options 召回选项
   */
  async recallByTags(
    sessionId: string,
    tags: string[],
    options?: RecallOptions
  ): Promise<RecalledMessage[]> {
    const topK = Math.max(1, options?.topK ?? DEFAULT_TOP_K);
    const excludeRecentN = Math.max(0, options?.excludeRecentN ?? DEFAULT_EXCLUDE_RECENT_N);

    // 1. 获取当前轮次（用于计算 ageInTurns 与排除最近 N 轮）
    const currentTurnIndex = await this.resolveCurrentTurnIndex(sessionId, options?.currentTurnIndex);

    // 2. 粗召回：按标签查倒排索引（候选池 = topK × 倍率）
    const candidateLimit = topK * CANDIDATE_MULTIPLIER;
    let candidates = tags.length > 0 
      ? await this.storage.getMessagesByTag(sessionId, tags, candidateLimit)
      : [];

    // 2.5 强力 Pin / Mute 机制注入候选池与排除配置
    let sessionObj2: any = null;
    try {
      if (typeof window !== 'undefined' && ((window as any).indexedDB || (window as any).shimIndexedDB)) {
        sessionObj2 = await getSessionById(sessionId);
      }
    } catch (err) {
      console.warn("[MemoryRecall] Failed to fetch session for Pin/Mute in recallByTags:", err);
    }
    const pinnedIds = sessionObj2?.pinnedMessageIds || [];
    const mutedIds = sessionObj2?.mutedMessageIds || [];
    const mutedIdSet = new Set(mutedIds);

    if (pinnedIds.length > 0) {
      // 异步查出被用户强力置顶的 Pin 消息内容
      const pinnedMsgsPromises = pinnedIds.map(id => this.storage.getMessageById(id));
      const pinnedMsgs = (await Promise.all(pinnedMsgsPromises)).filter(Boolean);
      
      // 合并到候选池并执行去重
      const candidateIds = new Set(candidates.map(c => c.id));
      pinnedMsgs.forEach(msg => {
        if (!candidateIds.has(msg.id)) {
          candidates.push(msg);
        }
      });
    }

    if (candidates.length === 0) return [];

    // 3. 获取最近 N 轮消息 ID（用于排除）
    const recentIds = await this.getRecentMessageIds(sessionId, excludeRecentN, currentTurnIndex);
    const recentIdSet = new Set(recentIds);

    // 4. 打分 + 排除 + 排序
    const scored = this.scoreCandidates(candidates, tags, currentTurnIndex, pinnedIds);
    const filtered = scored.filter((s) => !recentIdSet.has(s.messageId) && !mutedIdSet.has(s.messageId));

    // 5. 取 top-K
    return filtered.slice(0, topK);
  }

  // ===== 内部方法 =====

  /**
   * 解析当前轮次序号。
   * 优先使用调用方传入的值，否则从 messages Store 推断最后一条消息的 turnIndex + 1。
   */
  private async resolveCurrentTurnIndex(
    sessionId: string,
    explicit?: number
  ): Promise<number> {
    if (typeof explicit === 'number' && explicit >= 0) return explicit;

    // 查询所有消息，取最后一条的 turnIndex + 1
    // 注：对于 < 10k 消息的会话，此查询 < 20ms，可接受
    const allMessages = await this.storage.getMessagesBySession(sessionId);
    if (allMessages.length === 0) return 0;
    const last = allMessages[allMessages.length - 1];
    return (last.turnIndex ?? 0) + 1;
  }

  /**
   * 获取最近 N 轮消息的 ID 列表。
   * 通过查询所有消息并取最后 N 条（按 turnIndex 降序）。
   */
  private async getRecentMessageIds(
    sessionId: string,
    n: number,
    currentTurnIndex: number
  ): Promise<string[]> {
    if (n <= 0) return [];

    const allMessages = await this.storage.getMessagesBySession(sessionId);
    // 筛选 turnIndex >= currentTurnIndex - n 的消息
    const threshold = currentTurnIndex - n;
    return allMessages
      .filter((m) => m.turnIndex >= threshold)
      .map((m) => m.id);
  }

  /**
   * 候选打分：hitCount × (1 / (1 + ageInTurns / 50))。
   *
   * @param candidates 候选消息列表
   * @param queryTags 查询标签列表
   * @param currentTurnIndex 当前轮次
   * @returns 按 score 降序排序的 RecalledMessage 列表
   */
  private scoreCandidates(
    candidates: MessageRecord[],
    queryTags: string[],
    currentTurnIndex: number,
    pinnedIds: string[] = []
  ): RecalledMessage[] {
    const queryTagSet = new Set(queryTags);

    const scored: RecalledMessage[] = [];

    for (const msg of candidates) {
      // 强力 Pin 机制打分判定
      const isPinned = pinnedIds.includes(msg.id);

      // 计算命中标签
      const msgTags = msg.tags ?? [];
      const hitTags = msgTags.filter((t) => queryTagSet.has(t));
      const hitCount = hitTags.length;

      // 无匹配且不是 pinned 消息，则跳过
      if (hitCount === 0 && !isPinned) continue;

      // 计算时间衰减
      const ageInTurns = Math.max(0, currentTurnIndex - (msg.turnIndex ?? 0));
      const decayFactor = 1 / (1 + ageInTurns / DECAY_HALF_LIFE_TURNS);
      
      // 强力 Pin 置顶得分
      const score = isPinned ? 9999 : (hitCount * decayFactor);

      scored.push({
        messageId: msg.id,
        turnIndex: msg.turnIndex ?? 0,
        role: msg.role,
        content: msg.content,
        hitCount,
        hitTags,
        score,
      });
    }

    // 按 score 降序排序（同分时按 turnIndex 降序，优先返回较新的消息）
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.turnIndex - a.turnIndex;
    });

    return scored;
  }
}
