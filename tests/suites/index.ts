/**
 * 测试套件 barrel 文件
 *
 * 统一 re-export 所有测试函数，供 tests/run_all_tests.ts 聚合入口按需引用。
 * 拆分遵循 AGENTS.md 准则一与准则十：单文件 ≤1000 行，按测试域物理分轨。
 */

export { assert, parsePngMetadataLocal, PNG_SIGNATURE_HEADER_1, PNG_SIGNATURE_HEADER_2, PNG_IHDR_END_OFFSET } from "./testUtils";

export { testSsrfGuard } from "./security.test";

export {
  testDbQueue,
  testDatabaseServiceCrud,
  testLocalDBSplitTrack,
  testWriteQueueTimeout,
  testWriteQueueKeyCoalescing,
} from "./database.test";

export { testPromptBuilder, testPromptBuilderSystemMerging } from "./promptBuilder.test";
export { testPromptRuntime, testPromptServiceIntegration } from "./promptRuntime.test";

export { testPngCardParser } from "./cardParser.test";

export {
  testApiCleanRequestPayload,
  testSSEStreamWithReasoning,
  testCleanLLMResponse,
} from "./apiRequest.test";

export {
  testKernelFaultIsolation,
  testKernelPipeline,
  testKernelPipelineHardening,
  testKernelHardeningP0ToP3,
} from "./kernelPipeline.test";

export {
  testKernelKernelV2Fixes,
  testKernelV3Fixes,
  testKernelV4AbortAndInterrupt,
  testKernelExtensionRegistry,
  testKernelDestroyIdempotency,
  testKernelInspect,
} from "./kernelVersionFixes.test";

export { testKernelLifecycleAndDependencies, testBootstrapRollbackOnCriticalFailure } from "./kernelLifecycle.test";

export { testBisonModeProbability } from "./bisonMode.test";

export { testPresetAndWorldbookIntegration } from "./presetWorldbook.test";

export { testSuggestionsRobustness } from "./suggestions.test";

export {
  testMultiMessageService,
  testScriptServiceDecoupling,
  testOutputPipeline,
  testChatStreamService,
  testKeyManagerDynamicFetch,
  testUpdateCheckService,
} from "./services.test";

export {
  testCssSanitization,
  testServerLogDesensitization,
  testApiKeyEncryption,
} from "./rendering.test";

export {
  testFastPathL3AutoSummaryIndex,
  testFastPathL2ContentPrescan,
  testFastPathL1PipelineBypass,
} from "./fastPath.test";

export {
  testModelCapabilityRegistry,
  testMemoryStreamParser,
  testMemoryStorageCrud,
  testMemoryServiceLifecycle,
  testMemoryExtractor,
  testMemoryRecall,
} from "./memoryService.test";

export {
  testMemoryStateTable,
  testMemorySummary,
} from "./memoryStageC.test";

export { testMemoryE2E } from "./memoryE2E.test";
export { testTableMemorySchema } from "./tableMemorySchema.test";

export {
  testCharacterService,
  testWorldbookService,
  testSettingsService,
  testPresetService,
} from "./businessServices.test";

export {
  testTurnIndexBasicAppend,
  testTurnIndexDeleteMiddleThenAppend,
  testTurnIndexDeleteAllThenAppend,
  testTurnIndexMultipleAppends,
  testRerollBranchAtomicReplace,
} from "./turnIndexConsistency.test";

export {
  testMessageRoleMapping,
  testPaginationBoundaries,
  testAutoSummaryTriggerConditions,
  testAppendSessionMessageFieldMapping,
} from "./paginationAndArchival.test";

export {
  testAbortSignalPreAbortedLocalDB,
  testAbortSignalMidOperationLocalDB,
  testAbortSignalBeforeTransactionRegistration,
  testAbortSignalWriteQueueRecovery,
  testMvuParserAbortedCheckpoints,
  testMemoryStreamParserAbort,
} from "./abortSignalConduction.test";

export {
  testPublishSnapshotDuringConcurrentSubscribe,
  testDestroyWithMultipleActiveControllers,
} from "./kernelConcurrency.test";

// Kernel zod L2 Phase B：schema 单元测试（validateService / validateMessage / validateServiceRetrieval）
export { testKernelSchemaValidation } from "./kernelSchemaValidation.test";
export { testArchitectureBoundaries } from "./architectureBoundaries.test";
export { testPromptComposition } from "./promptComposition.test";
