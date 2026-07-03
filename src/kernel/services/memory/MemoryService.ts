/**
 * MemoryService - 记忆系统主服务入口
 *
 * 核心职责：
 *   1. 实现 IKernelService 契约，管理记忆系统生命周期与 AbortSignal 资源回收
 *   2. 整合并向中间件暴露子模块：MemoryStorage / Extractor / Recall / StateTable / Summary
 */

import { KernelServices, type IKernel, type IMemoryService, type IDatabaseService } from '../../types';
import { MemoryStorage } from './MemoryStorage';
import { MemoryExtractor } from './MemoryExtractor';
import { MemoryRecall } from './MemoryRecall';
import { MemoryStateTable } from './MemoryStateTable';
import { MemorySummary } from './MemorySummary';

export class MemoryService implements IMemoryService {
  readonly name = KernelServices.Memory;
  readonly dependencies = [KernelServices.Database, KernelServices.LLM] as const;

  /** 存储层子模块 */
  private storage: MemoryStorage | null = null;
  /** 抽取器子模块（阶段 B 装配） */
  private extractor: MemoryExtractor | null = null;
  /** 召回器子模块（阶段 B 装配） */
  private recall: MemoryRecall | null = null;
  /** 状态表子模块（阶段 C 装配，合并自 TableMemoryService） */
  private stateTable: MemoryStateTable | null = null;
  /** 摘要子模块（阶段 C 装配，瘦身自 AutoSummaryService） */
  private summary: MemorySummary | null = null;
  /** 服务级 AbortController */
  private abortController: AbortController | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }

    // 1. 获取 DatabaseService 引用（用于 MemoryStorage 装配）
    const dbService = kernel.getService<IDatabaseService>(KernelServices.Database);

    // 2. 初始化存储层（触发 IDB v8 schema 升级 + 装配 AbortSignal）
    this.storage = new MemoryStorage(dbService);
    await this.storage.init(this.abortController.signal);

    // 3. 装配抽取器（L0 LLM 抽取 + L1 词典匹配 + 调度队列）
    this.extractor = new MemoryExtractor(this.storage);
    this.extractor.init(this.abortController.signal);

    // 4. 装配召回器（标签倒排索引 + 时间衰减打分）
    this.recall = new MemoryRecall(this.storage);

    // 5. 装配状态表子模块（合并自 TableMemoryService）
    this.stateTable = new MemoryStateTable(this.storage);
    this.stateTable.init(this.abortController.signal);

    // 6. 装配摘要子模块（瘦身自 AutoSummaryService，砍掉 5 条正则状态抽离）
    this.summary = new MemorySummary(this.storage);
    this.summary.init(kernel, this.abortController.signal);
  }

  async destroy(kernel?: IKernel, signal?: AbortSignal): Promise<void> {
    // 传递 signal 给所有子模块，确保异步任务全部中止
    if (signal) {
      if (signal.aborted) this.abortController?.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }

    // 摘要子模块：中止进行中的 LLM 调用
    this.summary?.destroy(this.abortController?.signal);

    // 状态表子模块：纯计算服务，仅清理 abortController
    this.stateTable?.destroy(this.abortController?.signal);

    // 抽取器：中止进行中的异步抽取任务，清空队列
    this.extractor?.destroy(this.abortController?.signal);

    // 存储层：中止进行中的异步任务（IDB 事务自动回滚）
    this.storage?.destroy(this.abortController?.signal);

    this.abortController?.abort();
    this.abortController = null;
    this.storage = null;
    this.extractor = null;
    this.recall = null;
    this.stateTable = null;
    this.summary = null;
  }

  /**
   * 获取存储层 OOP 入口（messages / memory_dict Store CRUD）。
   */
  getStorage(): MemoryStorage {
    if (!this.storage) {
      throw new Error('[MemoryService] Storage not initialized. Call init() first.');
    }
    return this.storage;
  }

  /**
   * 获取抽取器（L0 LLM 抽取 + L1 词典匹配 + 调度队列）。
   * 供 output 中间件异步触发抽取。
   */
  getExtractor(): MemoryExtractor {
    if (!this.extractor) {
      throw new Error('[MemoryService] Extractor not initialized. Call init() first.');
    }
    return this.extractor;
  }

  /**
   * 获取召回器（标签倒排索引 + 时间衰减打分）。
   * 供 input 中间件召回相关历史注入 Prompt。
   */
  getRecall(): MemoryRecall {
    if (!this.recall) {
      throw new Error('[MemoryService] Recall not initialized. Call init() first.');
    }
    return this.recall;
  }

  /**
   * 获取状态表子模块（合并自 TableMemoryService）。
   * 供 output 中间件解析 AI 表格指令并执行 CRUD。
   */
  getStateTable(): MemoryStateTable {
    if (!this.stateTable) {
      throw new Error('[MemoryService] StateTable not initialized. Call init() first.');
    }
    return this.stateTable;
  }

  /**
   * 获取摘要子模块（瘦身自 AutoSummaryService）。
   * 供 output 中间件触发剧情时间线摘要。
   */
  getSummary(): MemorySummary {
    if (!this.summary) {
      throw new Error('[MemoryService] Summary not initialized. Call init() first.');
    }
    return this.summary;
  }
}
