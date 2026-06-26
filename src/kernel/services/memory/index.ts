/**
 * Memory 服务 barrel 文件
 *
 * 重新导出 MemoryService 子模块的公共 API，保持外部消费者导入路径不变。
 * 拆分遵循 AGENTS.md 准则一与准则十：单文件 ≤1000 行，按职责物理分轨。
 *
 * 阶段 A 导出：
 *   - MemoryService（主服务入口，注册到 KernelServices.Memory）
 *   - MemoryStorage（存储层 OOP 入口，供中间件与上层调用使用）
 *   - ModelCapabilityRegistry（模型能力防腐层，供阶段 B 抽取子模块使用）
 *   - MemoryStreamParser（流式 <memory> 标签解析器，供阶段 B 中间件使用）
 *   - 内部类型与 buildDictId 复合键构造函数
 *
 * 阶段 B 新增导出：
 *   - MemoryExtractor（L0 LLM 抽取 + L1 词典匹配 + 调度队列）
 *   - MemoryRecall（标签倒排索引 + 时间衰减打分 + top-K）
 *   - validateExtraction / extractByDict 纯函数（供中间件直接调用）
 *
 * 阶段 C 新增导出：
 *   - MemoryStateTable（合并自 TableMemoryService，状态表 CRUD + 默认表初始化）
 *   - MemorySummary（瘦身自 AutoSummaryService，砍掉 5 条正则状态抽离）
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第五章
 */

export { MemoryService } from './MemoryService';
export { MemoryStorage } from './MemoryStorage';
export { MemoryExtractor, validateExtraction, extractByDict } from './MemoryExtractor';
export type { ExtractionTask, ExtractionResult } from './MemoryExtractor';
export { MemoryRecall } from './MemoryRecall';
export type { RecallOptions } from './MemoryRecall';
export { MemoryStateTable } from './MemoryStateTable';
export type { ParsedTableAction, ProcessTableResult } from './MemoryStateTable';
export { MemorySummary } from './MemorySummary';
export { ModelCapabilityRegistry } from './ModelCapabilityRegistry';
export { MemoryStreamParser } from './MemoryStreamParser';
export { buildDictId } from './types';
export type {
  MessageRole,
  ExtractSource,
  EntityType,
  MessageRecord,
  MemoryDictEntry,
  MemoryExtraction,
  RecalledMessage,
  StreamParserOutput,
  ModelCapabilities,
  LLMParams,
} from './types';
