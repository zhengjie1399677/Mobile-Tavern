/**
 * 测试聚合入口
 *
 * 本文件为外部命令 `npm run test` 的入口（package.json: "test": "tsx tests/run_all_tests.ts"）。
 * 所有具体的测试函数已按测试域拆分到 tests/suites/ 目录下，barrel 文件统一 re-export。
 *
 * 改进：
 *   - 用数组+循环包裹每个测试函数，统一 await（对同步函数也安全）
 *   - 失败时不立即退出，跑完所有测试后汇总报告
 *   - 报告格式："X/Y passed, failed at: testNth"
 *
 * 多语言/组件测试归纳（2026-07-17）：
 *   - tests/vitest/** 下的 vitest 用例（含 i18n 50 项、组件渲染、服务集成共 327 项）
 *     通过 runVitestSuite() 子进程桥接纳入主流程，避免双测试系统割裂。
 *   - vitest 拥有独立 happy-dom 环境与 React Testing Library，子进程隔离避免污染自定义 runner。
 */

import { spawn } from "child_process";
import path from "path";
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
  testPromptRuntime,
  testPromptServiceIntegration,
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
  testKernelInspect,
  testKernelLifecycleAndDependencies,
  testBootstrapRollbackOnCriticalFailure,
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
  testMemoryE2E,
  testTableMemorySchema,
  testCharacterService,
  testWorldbookService,
  testSettingsService,
  testPresetService,
  testTurnIndexBasicAppend,
  testTurnIndexDeleteMiddleThenAppend,
  testTurnIndexDeleteAllThenAppend,
  testTurnIndexMultipleAppends,
  testRerollBranchAtomicReplace,
  testMessageRoleMapping,
  testPaginationBoundaries,
  testAutoSummaryTriggerConditions,
  testAppendSessionMessageFieldMapping,
  testAbortSignalPreAbortedLocalDB,
  testAbortSignalMidOperationLocalDB,
  testAbortSignalWriteQueueRecovery,
  testMvuParserAbortedCheckpoints,
  testMemoryStreamParserAbort,
  testPublishSnapshotDuringConcurrentSubscribe,
  testDestroyWithMultipleActiveControllers,
  testKernelSchemaValidation,
  testArchitectureBoundaries,
  testPromptComposition,
} from "./suites/index";

/**
 * 桥接 vitest 套件到主测试流程。
 *
 * tests/vitest/** 下的用例依赖 vitest 运行时（describe/it/expect）、happy-dom 环境
 * 与 React Testing Library，无法直接以普通函数形式并入自定义 runner。
 * 通过子进程调用本地 vitest 二进制执行 `vitest run`，以退出码判定成败：
 *   - 0：通过；非 0：失败并抛出，由主循环捕获计入失败汇总。
 *
 * 跨平台注意：Windows 下 node_modules/.bin/vitest 为 .cmd 批处理，需 shell:true；
 * Unix 下为带 shebang 的软链，可直接 exec。stdio:inherit 使 vitest 输出实时透传。
 */
async function runVitestSuite(): Promise<void> {
  console.log("\n--- Running Vitest Suite (tests/vitest/**, 含 i18n 多语言 50 项) ---");
  const isWin = process.platform === "win32";
  const bin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    isWin ? "vitest.cmd" : "vitest"
  );
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["run"], {
      stdio: "inherit",
      cwd: process.cwd(),
      shell: isWin,
    });
    child.on("close", (code) => {
      if (code === 0) {
        console.log("✓ Vitest suite passed");
        resolve();
      } else {
        reject(new Error(`Vitest suite failed with exit code ${code}`));
      }
    });
    child.on("error", (err) =>
      reject(new Error(`Failed to spawn vitest: ${err.message}`))
    );
  });
}

async function run() {
  setKernelStrictMode(false); // 默认在测试流程中采用生产（容错自愈）模式
  console.log("=================================================");
  console.log("🚀 STARTING ALL SYSTEM FUNCTIONAL TESTS");
  console.log("=================================================");

  // 测试函数清单（保持历史顺序，新增测试追加到末尾）
  const tests: { name: string; fn: () => Promise<void> | void }[] = [
    { name: "testSsrfGuard", fn: testSsrfGuard },
    { name: "testDbQueue", fn: testDbQueue },
    { name: "testPromptBuilder", fn: testPromptBuilder },
    { name: "testPromptRuntime", fn: testPromptRuntime },
    { name: "testPromptServiceIntegration", fn: testPromptServiceIntegration },
    { name: "testPngCardParser", fn: testPngCardParser },
    { name: "runCatbotErrorTests", fn: runCatbotErrorTests },
    { name: "testApiCleanRequestPayload", fn: testApiCleanRequestPayload },
    { name: "testSSEStreamWithReasoning", fn: testSSEStreamWithReasoning },
    { name: "testPromptBuilderSystemMerging", fn: testPromptBuilderSystemMerging },
    { name: "testKernelFaultIsolation", fn: testKernelFaultIsolation },
    { name: "testKernelPipeline", fn: testKernelPipeline },
    { name: "testKernelPipelineHardening", fn: testKernelPipelineHardening },
    { name: "testKernelHardeningP0ToP3", fn: testKernelHardeningP0ToP3 },
    { name: "testKernelKernelV2Fixes", fn: testKernelKernelV2Fixes },
    { name: "testKernelV3Fixes", fn: testKernelV3Fixes },
    { name: "testKernelV4AbortAndInterrupt", fn: testKernelV4AbortAndInterrupt },
    { name: "testKernelExtensionRegistry", fn: testKernelExtensionRegistry },
    { name: "testBisonModeProbability", fn: testBisonModeProbability },
    { name: "testPresetAndWorldbookIntegration", fn: testPresetAndWorldbookIntegration },
    { name: "testSuggestionsRobustness", fn: testSuggestionsRobustness },
    { name: "testMultiMessageService", fn: testMultiMessageService },
    { name: "testDatabaseServiceCrud", fn: testDatabaseServiceCrud },
    { name: "testOutputPipeline", fn: testOutputPipeline },
    { name: "testChatStreamService", fn: testChatStreamService },
    { name: "testApiKeyEncryption", fn: testApiKeyEncryption },
    { name: "testCssSanitization", fn: testCssSanitization },
    { name: "testServerLogDesensitization", fn: testServerLogDesensitization },
    // 内核服务覆盖补强测试
    { name: "testTableMemoryService", fn: testTableMemoryService },
    { name: "testPromptServiceRedosProtection", fn: testPromptServiceRedosProtection },
    { name: "testLLMServiceUrlValidation", fn: testLLMServiceUrlValidation },
    { name: "testAutoSummaryMetadataParsing", fn: testAutoSummaryMetadataParsing },
    { name: "testScriptServiceDecoupling", fn: testScriptServiceDecoupling },
    { name: "testLocalDBSplitTrack", fn: testLocalDBSplitTrack },
    { name: "testKeyManagerDynamicFetch", fn: testKeyManagerDynamicFetch },
    { name: "testUpdateCheckService", fn: testUpdateCheckService },
    { name: "testWriteQueueTimeout", fn: testWriteQueueTimeout },
    { name: "testKernelDestroyIdempotency", fn: testKernelDestroyIdempotency },
    { name: "testKernelInspect", fn: testKernelInspect },
    { name: "testKernelLifecycleAndDependencies", fn: testKernelLifecycleAndDependencies },
    // bootstrap 部分成功后失败的回滚机制测试（方案 A 批量回滚 + 方案 B 兜底全量清理）
    { name: "testBootstrapRollbackOnCriticalFailure", fn: testBootstrapRollbackOnCriticalFailure },
    // Kernel 并发快照防护测试（publish 订阅者列表快照 + destroy activeControllers 快照）
    { name: "testPublishSnapshotDuringConcurrentSubscribe", fn: testPublishSnapshotDuringConcurrentSubscribe },
    { name: "testDestroyWithMultipleActiveControllers", fn: testDestroyWithMultipleActiveControllers },
    { name: "testFastPathL3AutoSummaryIndex", fn: testFastPathL3AutoSummaryIndex },
    { name: "testFastPathL2ContentPrescan", fn: testFastPathL2ContentPrescan },
    { name: "testFastPathL1PipelineBypass", fn: testFastPathL1PipelineBypass },
    { name: "testCleanLLMResponse", fn: testCleanLLMResponse },
    { name: "testWriteQueueKeyCoalescing", fn: testWriteQueueKeyCoalescing },
    // 记忆系统阶段 A 测试（v8 物理分轨 + 服务骨架）
    { name: "testModelCapabilityRegistry", fn: testModelCapabilityRegistry },
    { name: "testMemoryStreamParser", fn: testMemoryStreamParser },
    { name: "testMemoryStorageCrud", fn: testMemoryStorageCrud },
    { name: "testMemoryServiceLifecycle", fn: testMemoryServiceLifecycle },
    // 记忆系统阶段 B 测试（L0/L1/L2 三级降级 + 标签倒排召回 + 时间衰减打分）
    { name: "testMemoryExtractor", fn: testMemoryExtractor },
    { name: "testMemoryRecall", fn: testMemoryRecall },
    // 记忆系统阶段 C 测试（状态表 CRUD + 瘦身摘要，砸 5 条正则状态抽离）
    { name: "testMemoryStateTable", fn: testMemoryStateTable },
    { name: "testMemorySummary", fn: testMemorySummary },
    // 记忆系统 E2E 测试（真实 IDB 端到端，覆盖 MockStorage 无法验证的物理层契约）
    { name: "testMemoryE2E", fn: testMemoryE2E },
    { name: "testTableMemorySchema", fn: testTableMemorySchema },
    // 业务服务插件测试（CharacterService/WorldbookService/SettingsService/PresetService CRUD 桥接）
    { name: "testCharacterService", fn: testCharacterService },
    { name: "testWorldbookService", fn: testWorldbookService },
    { name: "testSettingsService", fn: testSettingsService },
    { name: "testPresetService", fn: testPresetService },
    // turnIndex 一致性测试（验证删除中间消息后追加新消息不重复）
    { name: "testTurnIndexBasicAppend", fn: testTurnIndexBasicAppend },
    { name: "testTurnIndexDeleteMiddleThenAppend", fn: testTurnIndexDeleteMiddleThenAppend },
    { name: "testTurnIndexDeleteAllThenAppend", fn: testTurnIndexDeleteAllThenAppend },
    { name: "testTurnIndexMultipleAppends", fn: testTurnIndexMultipleAppends },
    { name: "testRerollBranchAtomicReplace", fn: testRerollBranchAtomicReplace },
    // 分页懒加载与总结归档测试（角色映射 / 分页边界 / 自动总结触发条件）
    { name: "testMessageRoleMapping", fn: testMessageRoleMapping },
    { name: "testPaginationBoundaries", fn: testPaginationBoundaries },
    { name: "testAutoSummaryTriggerConditions", fn: testAutoSummaryTriggerConditions },
    { name: "testAppendSessionMessageFieldMapping", fn: testAppendSessionMessageFieldMapping },
    // AbortSignal 协作式中断传导测试（TODO #5：IDB 事务主动 abort + MVU/流式解析器检查点）
    { name: "testAbortSignalPreAbortedLocalDB", fn: testAbortSignalPreAbortedLocalDB },
    { name: "testAbortSignalMidOperationLocalDB", fn: testAbortSignalMidOperationLocalDB },
    { name: "testAbortSignalWriteQueueRecovery", fn: testAbortSignalWriteQueueRecovery },
    { name: "testMvuParserAbortedCheckpoints", fn: testMvuParserAbortedCheckpoints },
    { name: "testMemoryStreamParserAbort", fn: testMemoryStreamParserAbort },
    // Kernel zod L2 Phase B：schema 单元测试（validateService / validateMessage / validateServiceRetrieval）
    { name: "testKernelSchemaValidation", fn: testKernelSchemaValidation },
    { name: "testArchitectureBoundaries", fn: testArchitectureBoundaries },
    { name: "testPromptComposition", fn: testPromptComposition },
    // vitest 套件桥接（i18n 多语言 50 项 + 组件渲染 + 服务集成，共 327 项）
    { name: "testVitestSuite", fn: runVitestSuite },
  ];

  let passed = 0;
  let failed = 0;
  const failures: { name: string; index: number; error: any }[] = [];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const label = `[${i + 1}/${tests.length}] ${test.name}`;
    try {
      await test.fn();
      passed++;
      console.log(`\n✅ ${label} passed`);
    } catch (err: any) {
      failed++;
      failures.push({ name: test.name, index: i + 1, error: err });
      console.error(`\n❌ ${label} FAILED`);
      console.error(err.stack || err.message);
    }
  }

  console.log("\n=================================================");
  console.log(`📊 TEST SUMMARY: ${passed} passed, ${failed} failed (total ${tests.length})`);
  if (failures.length > 0) {
    console.log("\nFailed tests:");
    failures.forEach(f => console.log(`  - #${f.index} ${f.name}`));
  }
  console.log("=================================================");

  if (failed > 0) {
    console.error(`\n❌ ${failed} TEST(S) FAILED!`);
    process.exit(1);
  }
  console.log("\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!");
}

run();
