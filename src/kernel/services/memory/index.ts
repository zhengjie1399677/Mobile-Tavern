/**
 * Memory 服务 barrel 文件
 *
 * 重新导出 MemoryService 子模块的公共 API、类与类型，保持外部消费者的导入路径不变。
 */

import type { IMemoryService } from '../../types';
import type { MemoryStorage } from './MemoryStorage';
import type { MemoryExtractor } from './MemoryExtractor';
import type { MemoryRecall } from './MemoryRecall';
import type { MemoryStateTable } from './MemoryStateTable';
import type { MemorySummary } from './MemorySummary';

/**
 * 已绑定具体子模块类型的 MemoryService 契约别名。
 *
 * 消费方使用 `kernel.getService<MemoryServiceTyped>("memory")` 即可一次性
 * 获得 5 个子模块（Storage/Extractor/Recall/StateTable/Summary）的具体类型，
 * 避免重复书写 5 个泛型参数。
 */
export type MemoryServiceTyped = IMemoryService<
  MemoryStorage,
  MemoryExtractor,
  MemoryRecall,
  MemoryStateTable,
  MemorySummary
>;

export { MemoryService } from './MemoryService';
export { MemoryStorage } from './MemoryStorage';
export { MemoryExtractor, validateExtraction, extractByDict } from './MemoryExtractor';
export type { ExtractionTask, ExtractionResult } from './MemoryExtractor';
export { MemoryRecall } from './MemoryRecall';
export { buildMemoryAuditSnapshot } from './MemoryAudit';
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
