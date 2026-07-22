/**
 * MemoryStorage - IndexedDB 读写封装（messages / memory_dict Store）
 *
 * 核心职责：
 *   1. 包装 messages 与 memory_dict 存储表的操作入口
 *   2. 管理与底层 IndexedDB 存储及 AbortSignal 异步事务生命周期
 */

import type {
  MemoryPersistencePort,
  MessageRecord,
  MemoryDictEntry,
  MemoryFragment,
  MemoryFragmentStatus,
} from './types';
import { buildDictId } from './types';

export class MemoryStorage {
  /** 记忆领域持久化端口；物理实现由组合根注入。 */
  private persistence: MemoryPersistencePort;
  /** 服务级 AbortController，destroy 时中止进行中的异步任务 */
  private abortController: AbortController | null = null;
  /** 是否已初始化 */
  private initialized = false;

  constructor(persistence: MemoryPersistencePort) {
    this.persistence = persistence;
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
    await this.persistence.appendMessage({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      turnIndex: message.turnIndex,
      tags: message.tags,
      extractSource: message.extractSource,
      metadata: message.metadata,
    }, this.getActiveSignal());
  }

  /**
   * 按 ID 合并更新消息的抽取字段（tags / extractSource / metadata）。
   * 保留 content / createdAt / role / turnIndex 等已有字段，避免覆盖竞态。
   */
  async updateMessageExtraction(
    id: string,
    tags: string[],
    extractSource: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    this.ensureInitialized();
    await this.persistence.updateMessageExtraction(
      id,
      tags,
      extractSource,
      metadata,
      this.getActiveSignal()
    );
  }

  /** 按主键单条直查消息 */
  async getMessageById(id: string): Promise<MessageRecord | null> {
    this.ensureInitialized();
    return this.persistence.getMessageById(id);
  }

  /**
   * 按会话查询所有消息（按 createdAt 升序）。
   * 支持分页参数 limit / offset。
   */
  async getMessagesBySession(
    sessionId: string,
    options?: { limit?: number; offset?: number; descending?: boolean }
  ): Promise<MessageRecord[]> {
    this.ensureInitialized();
    return this.persistence.getMessagesBySession(sessionId, options);
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
    return this.persistence.getMessagesByTag(sessionId, tags, limit);
  }

  /**
   * 删除指定会话的所有消息（用于会话删除时级联清理）。
   */
  async deleteMessagesBySession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await this.persistence.deleteMessagesBySession(sessionId, this.getActiveSignal());
  }

  // ===== memory_dict Store CRUD =====

  /**
   * 更新或插入词典条目（原子更新）。
   * 委托给 dbUpsertDictEntry 并在 IndexedDB 事务锁内处理读-改-写。
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
    // 配合已恢复的单对象签名进行调用
    return this.persistence.upsertDictEntry({
      sessionId,
      entity,
      aliases: patch.aliases,
      type: patch.type,
      firstSeenMsgId: patch.firstSeenMsgId,
      firstSeenTurn: patch.firstSeenTurn,
      count: patch.count,
    }, this.getActiveSignal());
  }

  /** 按主键单条直查词典条目 */
  async getDictEntryById(id: string): Promise<MemoryDictEntry | null> {
    this.ensureInitialized();
    return this.persistence.getDictEntryById(id);
  }

  /** 按会话查询所有词典条目 */
  async getDictBySession(sessionId: string): Promise<MemoryDictEntry[]> {
    this.ensureInitialized();
    return this.persistence.getDictBySession(sessionId);
  }

  /**
   * 删除指定会话的所有词典条目（用于会话删除时级联清理）。
   */
  async deleteDictBySession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await this.persistence.deleteDictBySession(sessionId, this.getActiveSignal());
  }

  /**
   * 删除指定主键的单个词典条目。
   */
  async deleteDictEntry(id: string): Promise<void> {
    this.ensureInitialized();
    await this.persistence.deleteDictEntryById(id, this.getActiveSignal());
  }

  // ===== memory_fragments Store CRUD =====

  async upsertFragment(fragment: MemoryFragment): Promise<void> {
    this.ensureInitialized();
    await this.persistence.upsertFragment(fragment, this.getActiveSignal());
  }

  async getFragmentById(id: string): Promise<MemoryFragment | null> {
    this.ensureInitialized();
    return this.persistence.getFragmentById(id);
  }

  async getFragmentsBySession(sessionId: string): Promise<MemoryFragment[]> {
    this.ensureInitialized();
    return this.persistence.getFragmentsBySession(sessionId);
  }

  async getFragmentsByTags(
    sessionId: string,
    tags: string[],
    limit?: number
  ): Promise<MemoryFragment[]> {
    this.ensureInitialized();
    return this.persistence.getFragmentsByTags(sessionId, tags, limit);
  }

  async supersedeFragment(originalId: string, replacement: MemoryFragment): Promise<void> {
    this.ensureInitialized();
    await this.persistence.supersedeFragment(originalId, replacement, this.getActiveSignal());
  }

  async updateFragmentStatus(id: string, status: MemoryFragmentStatus): Promise<void> {
    this.ensureInitialized();
    await this.persistence.updateFragmentStatus(id, status, this.getActiveSignal());
  }

  async deleteFragmentsBySession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    await this.persistence.deleteFragmentsBySession(sessionId, this.getActiveSignal());
  }

  // ===== 内部方法 =====

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[MemoryStorage] Not initialized. Call init() first.');
    }
  }
}
