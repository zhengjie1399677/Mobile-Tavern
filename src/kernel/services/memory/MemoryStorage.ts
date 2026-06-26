/**
 * MemoryStorage - IndexedDB 读写封装（messages / memory_dict Store）
 *
 * 物理职责：
 *   1. 包装 localDB.ts 中新增的 messages / memory_dict CRUD 函数，提供 OOP 入口
 *   2. 通过 init(signal) 确保 IDB schema 已升级到 v8（getDB 触发 onupgradeneeded）
 *   3. 提供 AbortSignal 绑定点，供内核销毁时中止进行中的异步事务
 *
 * 设计契约：
 *   - 所有写入操作复用 localDB.enqueueWrite 串行化队列与 key 合并机制
 *   - 严禁在 sessions 表中保留 messages 大数组（AGENTS.md 准则一物理分轨铁则）
 *   - 内存中不缓存消息列表，所有查询直击 IndexedDB，避免内存膨胀
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第五章 5.3 节
 */

import type { IDatabaseService } from '../../types';
import {
  appendMessage as dbAppendMessage,
  getMessageById as dbGetMessageById,
  getMessagesBySession as dbGetMessagesBySession,
  getMessagesByTag as dbGetMessagesByTag,
  deleteMessagesBySession as dbDeleteMessagesBySession,
  upsertDictEntry as dbUpsertDictEntry,
  getDictEntryById as dbGetDictEntryById,
  getDictBySession as dbGetDictBySession,
  deleteDictBySession as dbDeleteDictBySession,
  getDB,
} from '../../../utils/localDB';
import type { MessageRecord, MemoryDictEntry } from './types';
import { buildDictId } from './types';

export class MemoryStorage {
  /** 持有 DatabaseService 引用，用于未来扩展（如跨 Store 事务协调） */
  private dbService: IDatabaseService;
  /** 服务级 AbortController，destroy 时中止进行中的异步任务 */
  private abortController: AbortController | null = null;
  /** 是否已初始化 */
  private initialized = false;

  constructor(dbService: IDatabaseService) {
    this.dbService = dbService;
  }

  /**
   * 初始化存储层。
   * 调用 getDB() 触发 v8 schema 升级（onupgradeneeded 回调中创建新 Store）。
   */
  async init(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;

    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }

    // 触发 IDB 打开/升级，确保 messages 与 memory_dict Store 已就绪
    await getDB();

    this.initialized = true;
  }

  /**
   * 销毁存储层。
   * 中止进行中的异步任务。IDB 事务自身会在 abort 时自动回滚，无需手动处理。
   */
  destroy(signal?: AbortSignal): void {
    if (signal) {
      if (signal.aborted) this.abortController?.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
    this.abortController?.abort();
    this.abortController = null;
    this.initialized = false;
  }

  /**
   * 获取当前 AbortSignal（供外部异步任务绑定）。
   * 若未初始化或已销毁，返回一个已 aborted 的 signal 以快速失败。
   */
  getActiveSignal(): AbortSignal {
    if (!this.abortController) {
      const ctrl = new AbortController();
      ctrl.abort();
      return ctrl.signal;
    }
    return this.abortController.signal;
  }

  // ===== messages Store CRUD =====

  /**
   * 追加一条消息到 messages Store。
   * 使用 enqueueWrite 串行化写入，key 合并机制确保同 ID 多次写入只落盘最新版本。
   */
  async appendMessage(message: MessageRecord): Promise<void> {
    this.ensureInitialized();
    await dbAppendMessage({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      turnIndex: message.turnIndex,
      tags: message.tags,
      extractSource: message.extractSource,
      metadata: message.metadata,
    });
  }

  /** 按主键单条直查消息 */
  async getMessageById(id: string): Promise<MessageRecord | null> {
    this.ensureInitialized();
    return dbGetMessageById(id);
  }

  /**
   * 按会话查询所有消息（按 createdAt 升序）。
   * 支持分页参数 limit / offset。
   */
  async getMessagesBySession(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<MessageRecord[]> {
    this.ensureInitialized();
    return dbGetMessagesBySession(sessionId, options);
  }

  /**
   * 按标签查询消息（倒排召回）。
   * 使用 tags 多值索引，返回命中任一标签的消息列表。
   */
  async getMessagesByTag(
    sessionId: string,
    tags: string[],
    limit?: number
  ): Promise<MessageRecord[]> {
    this.ensureInitialized();
    return dbGetMessagesByTag(sessionId, tags, limit);
  }

  /**
   * 删除指定会话的所有消息（用于会话删除时级联清理）。
   */
  async deleteMessagesBySession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await dbDeleteMessagesBySession(sessionId);
  }

  // ===== memory_dict Store CRUD =====

  /**
   * 更新或插入词典条目。
   * 若条目已存在（按复合键 `${sessionId}:${entity}`），将更新 count 与 updatedAt。
   * 若为新条目，将插入完整记录。
   *
   * @returns true 表示新建，false 表示更新
   */
  async upsertDictEntry(
    sessionId: string,
    entity: string,
    patch: Partial<Omit<MemoryDictEntry, 'id' | 'sessionId' | 'entity'>> & {
      firstSeenMsgId: string;
      firstSeenTurn: number;
    }
  ): Promise<boolean> {
    this.ensureInitialized();
    const id = buildDictId(sessionId, entity);
    const existing = await dbGetDictEntryById(id);
    const now = Date.now();

    if (existing) {
      // 更新：count 自增（除非显式传入），updatedAt 刷新
      const nextCount = patch.count !== undefined ? patch.count : (existing.count || 0) + 1;
      await dbUpsertDictEntry({
        id,
        sessionId,
        entity,
        aliases: patch.aliases ?? existing.aliases ?? [],
        type: patch.type ?? existing.type ?? 'concept',
        firstSeenMsgId: existing.firstSeenMsgId,
        firstSeenTurn: existing.firstSeenTurn,
        count: nextCount,
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return false;
    }

    // 新建
    await dbUpsertDictEntry({
      id,
      sessionId,
      entity,
      aliases: patch.aliases ?? [],
      type: patch.type ?? 'concept',
      firstSeenMsgId: patch.firstSeenMsgId,
      firstSeenTurn: patch.firstSeenTurn,
      count: patch.count ?? 1,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  }

  /** 按主键单条直查词典条目 */
  async getDictEntryById(id: string): Promise<MemoryDictEntry | null> {
    this.ensureInitialized();
    return dbGetDictEntryById(id);
  }

  /** 按会话查询所有词典条目 */
  async getDictBySession(sessionId: string): Promise<MemoryDictEntry[]> {
    this.ensureInitialized();
    return dbGetDictBySession(sessionId);
  }

  /**
   * 删除指定会话的所有词典条目（用于会话删除时级联清理）。
   */
  async deleteDictBySession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await dbDeleteDictBySession(sessionId);
  }

  // ===== 内部方法 =====

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[MemoryStorage] Not initialized. Call init() first.');
    }
  }
}
