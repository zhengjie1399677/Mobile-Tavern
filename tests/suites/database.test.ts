/**
 * 数据库与写队列测试套件
 *
 * 覆盖：
 *  - testDbQueue：写队列串行化与异常恢复
 *  - testDatabaseServiceCrud：DatabaseService 创建/分支/时间线分支
 *  - testLocalDBSplitTrack：localDB settings 分轨存储与回读合并
 *  - testWriteQueueTimeout：写队列事务级超时熔断（P0-2）
 *  - testWriteQueueKeyCoalescing：写队列 key 合并机制（P1-11）
 */

import { Kernel } from "../../src/kernel/Kernel";
import { IKernelService } from "@/src/application/serviceContracts";
import { DatabaseService } from "../../src/application/services/DatabaseService";
import type { CharacterCard } from "../../src/types";
import { assert } from "./testUtils";
// fake-indexeddb 全局注入：替代 testLocalDBSplitTrack 原先的手写 mock。
// 手写 mock 的 oncomplete 调度时序与真实 IDB 存在差异，是历史 flaky 源头；
// fake-indexeddb 完整实现 IDB 协议（含事务提交、索引、cursor），测试更接近生产行为。
// 对不依赖 IDB 的测试（testDbQueue/testWriteQueueTimeout 等）无副作用。
import 'fake-indexeddb/auto';

export async function testDbQueue() {
  console.log("\n--- Running DB Concurrency Queue Verification ---");
  let writeQueue = Promise.resolve();

  function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation);
    writeQueue = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const executionOrder: string[] = [];

  const p1 = enqueueWrite(async () => {
    executionOrder.push("start 1");
    await delay(50);
    executionOrder.push("end 1");
    return "val1";
  });

  const p2 = enqueueWrite(async () => {
    executionOrder.push("start 2 (fail)");
    await delay(30);
    executionOrder.push("end 2 (fail)");
    throw new Error("error2");
  });

  const p3 = enqueueWrite(async () => {
    executionOrder.push("start 3");
    await delay(20);
    executionOrder.push("end 3");
    return "val3";
  });

  assert(await p1 === "val1", "p1 returns correct resolution");
  try {
    await p2;
    throw new Error("p2 should reject");
  } catch (e: any) {
    assert(e.message === "error2", "p2 returns correct rejection");
  }
  assert(await p3 === "val3", "p3 returns correct resolution");

  const expectedOrder = [
    "start 1", "end 1",
    "start 2 (fail)", "end 2 (fail)",
    "start 3", "end 3"
  ];
  assert(JSON.stringify(executionOrder) === JSON.stringify(expectedOrder), "Queue runs sequentially");
  console.log("✔ DB Queue serialization and error recovery verified!");
}

export async function testDatabaseServiceCrud() {
  console.log("\n--- Running DatabaseService CRUD Verification ---");
  const testKernel = new Kernel();

  let savedSession: any = null;
  const mockScriptService: IKernelService = {
    name: "script",
    init() {},
    initializeMvuFromCharacter(char: any) {
      return { hp: 100 };
    }
  } as unknown as IKernelService;

  const mockDbService = new DatabaseService();
  mockDbService.saveSession = async (sess: any) => {
    savedSession = sess;
  };
  // Mock syncSessionMessages 防止触发 getDB() 缓存 dbInstance，污染后续测试
  mockDbService.syncSessionMessages = async () => {};

  await testKernel.registerService("script", mockScriptService);
  await testKernel.registerService("database", mockDbService);

  const mockChar = { id: "char-123", name: "银霜", first_mes: "你好" } as unknown as CharacterCard;
  const session = await mockDbService.createNewSession(mockChar, "你好啊", ["选项一"]);

  assert(session.characterId === "char-123", "Session character ID matches");
  assert(session.messages.length === 1, "Should have starter message");
  assert(session.messages[0].content.includes("你好啊"), "Message content matches");
  assert(session.variables?.hp === 100, "MVU variables initialized");
  assert(savedSession !== null, "Session saved");

  const backtrackSession = await mockDbService.createBacktrackBranch(session, "新分支", session.messages[0].id);
  assert(backtrackSession.title === "新分支", "Backtrack title matches");
  assert(backtrackSession.messages.length === 1, "Backtrack messages count matches");

  session.summaries = [{
    id: "sum_1",
    timeTag: "深夜",
    location: "旅馆",
    content: "发生战斗",
    lastMessageId: session.messages[0].id,
  }];
  const timelineSession = await mockDbService.createBacktrackFromTimeline(session, "时间流分支", "sum_1");
  assert(timelineSession.summaries.length === 1, "Timeline session summaries count matches");
  assert(timelineSession.messages[0].content.includes("发生战斗"), "Timeline message content matches");
  assert(timelineSession.parentSessionId === session.id, "Timeline branch keeps parent session");
  assert(timelineSession.parentMessageId === session.messages[0].id, "Timeline branch keeps split message");

  await testKernel.destroy();
  console.log("✔ DatabaseService CRUD verified successfully!");
}

export async function testLocalDBSplitTrack() {
  console.log("\n--- Running localDB settings Split-Track Storage Verification ---");
  const localDB = await import("../../src/utils/localDB");
  // fake-indexeddb 已在文件顶部全局注入，此处仅需清 localDB 的 dbInstance 缓存，
  // 确保本测试拿到的是干净的 fake-indexeddb 连接（前序测试可能已缓存旧连接）。
  localDB.__resetDBInstanceForTesting();

  // db 提到 try 外：finally 中需要用它清理 settings store，防止本测试写入的数据
  // 污染后续测试（fake-indexeddb 数据库跨测试持久，testSettingsService 期望初始为 null）。
  let db: IDBDatabase | null = null;
  try {
    // 1. 模拟要保存的 settings
    const testSettings: any = {
      api: { apiKey: "sk-test-key-abc" },
      promptConfig: {
        mainPrompt: "SYSTEM: Hello World",
        jailbreakPrompt: "JB: Act normal",
        postHistoryPrompt: "POST: End of history",
        reasoningGuidancePrompt: "REASON: Think step-by-step",
        tableMemoryPrompt: "MEM: Keep table",
        composition: {
          id: "composition-storage-test",
          name: "存储测试编排",
          version: 1,
          blocks: [],
        },
      },
      bisonModePrompt: "BISON: Mode prompt",
      replySuggestionsPrompt: "SUGGEST: Options",
      otherOption: "enabled"
    };

    // 2. 执行保存
    await localDB.saveStoredSettings(testSettings);

    // 3. 验证分轨后的物理存储结构：直接读取 settings store 原始值
    //    （fake-indexeddb 提供真实 IDB 语义，不再依赖手写 mock 的 mockStorage）
    db = await localDB.getDB();
    const readSetting = (key: string) => new Promise<any>((resolve, reject) => {
      const tx = db!.transaction("settings", "readonly");
      const req = tx.objectStore("settings").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
    const rawUserSettings = await readSetting("user_settings");
    const rawLargePrompts = await readSetting("user_settings_large_prompts");

    assert(rawUserSettings !== undefined, "user_settings should be written");
    assert(rawUserSettings.promptConfig.mainPrompt === "", "mainPrompt in user_settings must be cleared");
    assert(rawUserSettings.promptConfig.reasoningGuidancePrompt === "", "reasoningGuidancePrompt in user_settings must be cleared");
    assert(rawUserSettings.promptConfig.composition === undefined, "prompt composition in user_settings must be cleared");
    assert(rawUserSettings.bisonModePrompt === "", "bisonModePrompt in user_settings must be cleared");
    assert(rawUserSettings.otherOption === "enabled", "other fields must remain intact");

    assert(rawLargePrompts !== undefined, "user_settings_large_prompts should be written");
    assert(rawLargePrompts.mainPrompt === "SYSTEM: Hello World", "mainPrompt must be stored in large prompts");
    assert(rawLargePrompts.reasoningGuidancePrompt === "REASON: Think step-by-step", "reasoningGuidancePrompt must be stored in large prompts");
    assert(rawLargePrompts.bisonModePrompt === "BISON: Mode prompt", "bisonModePrompt must be stored in large prompts");
    assert(rawLargePrompts.promptComposition?.id === "composition-storage-test", "prompt composition must be stored in large prompts");

    // 4. 执行读取（含解密 + 合并 largePrompts）
    const loadedSettings = await localDB.getStoredSettings() as unknown as {
      promptConfig: { mainPrompt: string; reasoningGuidancePrompt: string; composition?: { id: string } };
      bisonModePrompt: string;
      otherOption: string;
    };

    assert(loadedSettings !== null, "getStoredSettings should return object");

    // 5. 验证读取合并后的内容是否与原 settings 一致
    assert(loadedSettings.promptConfig.mainPrompt === "SYSTEM: Hello World", "Merged mainPrompt matches");
    assert(loadedSettings.promptConfig.reasoningGuidancePrompt === "REASON: Think step-by-step", "Merged reasoningGuidancePrompt matches");
    assert(loadedSettings.promptConfig.composition?.id === "composition-storage-test", "Merged prompt composition matches");
    assert(loadedSettings.bisonModePrompt === "BISON: Mode prompt", "Merged bisonModePrompt matches");
    assert(loadedSettings.otherOption === "enabled", "Merged otherOption matches");

    console.log("✔ localDB settings Split-Track Storage and Merge verified successfully!");
  } finally {
    // 清理本测试写入的 settings store 数据 + crypto key 缓存：
    // fake-indexeddb 数据库跨测试持久，若不清理，后续 testSettingsService 期望"初始为 null"会失败。
    // 即使 assert 抛错也必须执行清理，避免单测失败连锁污染后续测试。
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction("settings", "readwrite");
          const store = tx.objectStore("settings");
          store.delete("user_settings");
          store.delete("user_settings_large_prompts");
          store.delete("api_crypto_key");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
        });
      } catch (cleanupErr) {
        console.error("[testLocalDBSplitTrack] cleanup failed:", cleanupErr);
      }
    }
    // 重置 crypto key 缓存 + dbInstance 缓存，让后续测试从干净状态开始
    localDB.__resetDBInstanceForTesting();
  }
}

/**
 * P0-2 修复验证：写队列事务级超时机制
 * 验证 Promise.race + timeout 模式能正确中断挂起操作，且不阻塞后续写入。
 */
export async function testWriteQueueTimeout() {
  console.log("\n--- Running Write Queue Timeout Verification (P0-2) ---");

  const SHORT_TIMEOUT_MS = 200;
  let testQueue: Promise<any> = Promise.resolve();

  function enqueueWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    const queuedOperation = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Write operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([operation(), timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };
    const result = testQueue.then(queuedOperation);
    testQueue = result.then(() => {}, () => {});
    return result;
  }

  // 1. 挂起操作应被超时中断
  const hangingOp = enqueueWithTimeout(() => new Promise<string>(() => {}), SHORT_TIMEOUT_MS);
  let hangingRejected = false;
  let rejectReason = "";
  try {
    await hangingOp;
  } catch (e: any) {
    hangingRejected = true;
    rejectReason = e.message;
  }
  assert(hangingRejected, "Hanging operation should be rejected by timeout");
  assert(rejectReason.includes("timed out"), "Rejection message should mention timeout");

  // 2. 超时后的后续操作应能正常执行（写队列未被永久阻塞）
  const followUpResult = await enqueueWithTimeout(async () => "follow-up-success", SHORT_TIMEOUT_MS);
  assert(followUpResult === "follow-up-success", "Subsequent operation should succeed after timeout");

  // 3. 正常快速操作应不受超时影响
  const fastResult = await enqueueWithTimeout(async () => {
    await new Promise(r => setTimeout(r, 10));
    return "fast-success";
  }, SHORT_TIMEOUT_MS);
  assert(fastResult === "fast-success", "Fast operation should complete normally");

  console.log("✔ Write Queue Timeout verified successfully!");
}

/**
 * P1-11 修复验证：写队列 key 合并机制
 * 验证同一 key 的多个写操作仅执行最后一次（最新数据获胜），不同 key 互不影响。
 */
export async function testWriteQueueKeyCoalescing() {
  console.log("\n--- Running Write Queue Key Coalescing (P1-11) Verification ---");

  // 模拟 enqueueWrite 的 key 合并逻辑（与 localDB.ts 中的实现等价）
  interface CoalescedSlot<T> {
    operation: () => Promise<T>;
    pendingPromise: Promise<T> | null;
  }
  const pendingKeyedWrites = new Map<string, CoalescedSlot<any>>();

  async function enqueueWriteSim<T>(operation: () => Promise<T>, key?: string): Promise<T> {
    // key 合并：同 key 仅保留最新 operation
    if (key) {
      const existing = pendingKeyedWrites.get(key);
      if (existing) {
        existing.operation = operation;
        return existing.pendingPromise as Promise<T>;
      }
    }
    const slot: CoalescedSlot<T> = { operation, pendingPromise: null };
    if (key) pendingKeyedWrites.set(key, slot);

    // 模拟实际 writeQueue.then() 的微任务延迟执行：
    // pendingKeyedWrites.delete(key) 必须在微任务中执行（而非同步），
    // 这样同步发起的多个同 key 写入才能找到已有 slot 并合并。
    const result = Promise.resolve().then(async () => {
      if (key) pendingKeyedWrites.delete(key);
      const latestOp = slot.operation;
      return await latestOp();
    });

    slot.pendingPromise = result;
    return result;
  }

  // 测试 1：同 key 多次写入仅执行最后一次
  let executionCount = 0;
  let lastExecutedValue = "";

  const promises: Promise<string>[] = [];
  // 快速连续发起 3 个同 key 写入
  promises.push(enqueueWriteSim(async () => { executionCount++; lastExecutedValue = "v1"; return "v1"; }, "session:test-1"));
  promises.push(enqueueWriteSim(async () => { executionCount++; lastExecutedValue = "v2"; return "v2"; }, "session:test-1"));
  promises.push(enqueueWriteSim(async () => { executionCount++; lastExecutedValue = "v3"; return "v3"; }, "session:test-1"));

  const results = await Promise.all(promises);

  // 仅执行 1 次（最后一次 operation 获胜）
  assert(executionCount === 1, `Same-key writes should execute only once, got ${executionCount}`);
  assert(lastExecutedValue === "v3", `Last operation should win, got ${lastExecutedValue}`);
  // 所有 3 个 Promise 都应 resolve 为最终值
  assert(results[0] === "v3", `First caller should get coalesced result, got ${results[0]}`);
  assert(results[1] === "v3", `Second caller should get coalesced result, got ${results[1]}`);
  assert(results[2] === "v3", `Third caller should get coalesced result, got ${results[2]}`);

  // 测试 2：不同 key 的写入互不影响，各自独立执行
  let execA = 0, execB = 0;
  await Promise.all([
    enqueueWriteSim(async () => { execA++; return "a1"; }, "session:A"),
    enqueueWriteSim(async () => { execB++; return "b1"; }, "session:B"),
  ]);
  assert(execA === 1, "Different key A should execute independently");
  assert(execB === 1, "Different key B should execute independently");

  // 测试 3：无 key 的写入不参与合并
  let execNoKey = 0;
  await Promise.all([
    enqueueWriteSim(async () => { execNoKey++; return "x1"; }),
    enqueueWriteSim(async () => { execNoKey++; return "x2"; }),
    enqueueWriteSim(async () => { execNoKey++; return "x3"; }),
  ]);
  assert(execNoKey === 3, `No-key writes should all execute independently, got ${execNoKey}`);

  console.log("✔ Write Queue Key Coalescing (P1-11) verified successfully!");
}
