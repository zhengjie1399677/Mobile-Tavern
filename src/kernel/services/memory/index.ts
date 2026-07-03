/**
 * Memory 服务 barrel 文件
 *
 * 重新导出 MemoryService 子模块的公共 API、类与类型，保持外部消费者的导入路径不变。
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
