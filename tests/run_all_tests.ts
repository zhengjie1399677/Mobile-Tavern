/**
 * 测试聚合入口
 *
 * 本文件为外部命令 `npm run test` 的入口（package.json: "test": "tsx tests/run_all_tests.ts"）。
 * 所有具体的测试函数已按测试域拆分到 tests/suites/ 目录下，barrel 文件统一 re-export。
 * 此处仅保留 run() 聚合器与末尾的 run() 调用，调用顺序与历史版本保持一致。
 */

import { setKernelStrictMode } from "../src/kernel/Kernel";
import { runCatbotErrorTests } from "./test_catbot_error_handling";
import {
  testTableMemoryService,
  testPromptServiceRedosProtection,
  testLLMServiceUrlValidation,
  testAutoSummaryMetadataParsing,
} from "./test_kernel_services_coverage";
import {
  testSsrfGuard,
  testDbQueue,
  testPromptBuilder,
  testPngCardParser,
  testApiCleanRequestPayload,
  testSSEStreamWithReasoning,
  testPromptBuilderSystemMerging,
  testKernelFaultIsolation,
  testKernelPipeline,
  testKernelPipelineHardening,
  testKernelHardeningP0ToP3,
  testKernelKernelV2Fixes,
  testKernelV3Fixes,
  testKernelV4AbortAndInterrupt,
  testKernelExtensionRegistry,
  testBisonModeProbability,
  testPresetAndWorldbookIntegration,
  testSuggestionsRobustness,
  testMultiMessageService,
  testDatabaseServiceCrud,
  testOutputPipeline,
  testChatStreamService,
  testApiKeyEncryption,
  testCssSanitization,
  testServerLogDesensitization,
  testScriptServiceDecoupling,
  testLocalDBSplitTrack,
  testKeyManagerDynamicFetch,
  testUpdateCheckService,
  testWriteQueueTimeout,
  testKernelDestroyIdempotency,
  testFastPathL3AutoSummaryIndex,
  testFastPathL2ContentPrescan,
  testFastPathL1PipelineBypass,
  testCleanLLMResponse,
  testWriteQueueKeyCoalescing,
  testModelCapabilityRegistry,
  testMemoryStreamParser,
  testMemoryStorageCrud,
  testMemoryServiceLifecycle,
  testMemoryExtractor,
  testMemoryRecall,
  testMemoryStateTable,
  testMemorySummary,
} from "./suites/index";

async function run() {
  setKernelStrictMode(false); // 默认在测试流程中采用生产（容错自愈）模式
  console.log("=================================================");
  console.log("🚀 STARTING ALL SYSTEM FUNCTIONAL TESTS");
  console.log("=================================================");
  try {
    await testSsrfGuard();
    await testDbQueue();
    testPromptBuilder();
    await testPngCardParser();
    runCatbotErrorTests();
    testApiCleanRequestPayload();
    await testSSEStreamWithReasoning();
    testPromptBuilderSystemMerging();
    await testKernelFaultIsolation();
    await testKernelPipeline();
    await testKernelPipelineHardening();
    await testKernelHardeningP0ToP3();
    await testKernelKernelV2Fixes();
    await testKernelV3Fixes();
    await testKernelV4AbortAndInterrupt();
    await testKernelExtensionRegistry();
    testBisonModeProbability();
    testPresetAndWorldbookIntegration();
    testSuggestionsRobustness();
    await testMultiMessageService();
    await testDatabaseServiceCrud();
    await testOutputPipeline();
    await testChatStreamService();
    await testApiKeyEncryption();
    await testCssSanitization();
    testServerLogDesensitization();
    // 内核服务覆盖补强测试
    await testTableMemoryService();
    await testPromptServiceRedosProtection();
    await testLLMServiceUrlValidation();
    await testAutoSummaryMetadataParsing();
    await testScriptServiceDecoupling();
    await testLocalDBSplitTrack();
    await testKeyManagerDynamicFetch();
    await testUpdateCheckService();
    await testWriteQueueTimeout();
    await testKernelDestroyIdempotency();
    await testFastPathL3AutoSummaryIndex();
    await testFastPathL2ContentPrescan();
    await testFastPathL1PipelineBypass();
    await testCleanLLMResponse();
    await testWriteQueueKeyCoalescing();
    // 记忆系统阶段 A 测试（v8 物理分轨 + 服务骨架）
    await testModelCapabilityRegistry();
    await testMemoryStreamParser();
    await testMemoryStorageCrud();
    await testMemoryServiceLifecycle();
    // 记忆系统阶段 B 测试（L0/L1/L2 三级降级 + 标签倒排召回 + 时间衰减打分）
    await testMemoryExtractor();
    await testMemoryRecall();
    // 记忆系统阶段 C 测试（状态表 CRUD + 瘦身摘要，砸 5 条正则状态抽离）
    await testMemoryStateTable();
    await testMemorySummary();
    console.log("\n=================================================");
    console.log("🎉 ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("=================================================");
  } catch (err: any) {
    console.error("\n❌ TESTS FAILED!");
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

run();
