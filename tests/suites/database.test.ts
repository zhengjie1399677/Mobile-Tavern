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
import { IKernelService } from "../../src/kernel/types";
import { DatabaseService } from "../../src/kernel/services/DatabaseService";
import { assert } from "./testUtils";

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
  };

  const mockDbService = new DatabaseService();
  mockDbService.saveSession = async (sess: any) => {
    savedSession = sess;
  };
  // Mock syncSessionMessages 防止触发 getDB() 缓存 dbInstance，污染后续测试
  mockDbService.syncSessionMessages = async () => {};

  await testKernel.registerService("script", mockScriptService);
  await testKernel.registerService("database", mockDbService);

  const mockChar = { id: "char-123", name: "银霜", first_mes: "你好" };
  const session = await mockDbService.createNewSession(mockChar, "你好啊", ["选项一"]);

  assert(session.characterId === "char-123", "Session character ID matches");
  assert(session.messages.length === 1, "Should have starter message");
  assert(session.messages[0].content.includes("你好啊"), "Message content matches");
  assert(session.variables?.hp === 100, "MVU variables initialized");
  assert(savedSession !== null, "Session saved");

  const backtrackSession = await mockDbService.createBacktrackBranch(session, "新分支", session.messages[0].id);
  assert(backtrackSession.title === "新分支", "Backtrack title matches");
  assert(backtrackSession.messages.length === 1, "Backtrack messages count matches");

  session.summaries = [{ id: "sum_1", timeTag: "深夜", location: "旅馆", content: "发生战斗" }];
  const timelineSession = await mockDbService.createBacktrackFromTimeline(session, "时间流分支", "sum_1");
  assert(timelineSession.summaries.length === 1, "Timeline session summaries count matches");
  assert(timelineSession.messages[0].content.includes("发生战斗"), "Timeline message content matches");

  await testKernel.destroy();
  console.log("✔ DatabaseService CRUD verified successfully!");
}

export async function testLocalDBSplitTrack() {
  console.log("\n--- Running localDB settings Split-Track Storage Verification ---");
  const localDB = await import("../../src/utils/localDB");
  // 清除可能由前序测试缓存的 dbInstance，确保本测试的 mock indexedDB 能生效
  localDB.__resetDBInstanceForTesting();

  // 1. Mock 内存数据库存储
  const mockStorage: Record<string, any> = {};

  // Mock IDBObjectStore
  const mockStore = {
    get: (key: string) => {
      const request: any = { result: mockStorage[key] };
      setTimeout(() => {
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    },
    put: (value: any, key?: string) => {
      mockStorage[key || value.id] = value;
      const request: any = { result: key || value.id };
      setTimeout(() => {
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    }
  };

  // Mock IDBTransaction
  const mockTransaction = {
    objectStore: (name: string) => mockStore,
    oncomplete: null as any,
    onerror: null as any,
    error: null
  };

  // Mock IDBDatabase
  const mockDb = {
    transaction: (storeNames: any, mode: any) => mockTransaction
  };

  // 注入 mock DB 实例到 localDB 中以避免调用真实的 indexedDB.open
  const originalIndexedDB = (global as any).indexedDB;

  (global as any).indexedDB = {
    open: () => {
      const request: any = {};
      setTimeout(() => {
        request.result = mockDb;
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    }
  } as any;

  // 2. 模拟要保存的 settings
  const testSettings: any = {
    api: { apiKey: "sk-test-key-abc" },
    promptConfig: {
      mainPrompt: "SYSTEM: Hello World",
      jailbreakPrompt: "JB: Act normal",
      postHistoryPrompt: "POST: End of history",
      reasoningGuidancePrompt: "REASON: Think step-by-step",
      tableMemoryPrompt: "MEM: Keep table",
    },
    bisonModePrompt: "BISON: Mode prompt",
    replySuggestionsPrompt: "SUGGEST: Options",
    otherOption: "enabled"
  };

  // 3. 执行保存
  await localDB.saveStoredSettings(testSettings);

  // 4. 验证分轨后的物理存储结构
  const rawUserSettings = mockStorage["user_settings"];
  assert(rawUserSettings !== undefined, "user_settings should be written");
  assert(rawUserSettings.promptConfig.mainPrompt === "", "mainPrompt in user_settings must be cleared");
  assert(rawUserSettings.promptConfig.reasoningGuidancePrompt === "", "reasoningGuidancePrompt in user_settings must be cleared");
  assert(rawUserSettings.bisonModePrompt === "", "bisonModePrompt in user_settings must be cleared");
  assert(rawUserSettings.otherOption === "enabled", "other fields must remain intact");

  const rawLargePrompts = mockStorage["user_settings_large_prompts"];
  assert(rawLargePrompts !== undefined, "user_settings_large_prompts should be written");
  assert(rawLargePrompts.mainPrompt === "SYSTEM: Hello World", "mainPrompt must be stored in large prompts");
  assert(rawLargePrompts.reasoningGuidancePrompt === "REASON: Think step-by-step", "reasoningGuidancePrompt must be stored in large prompts");
  assert(rawLargePrompts.bisonModePrompt === "BISON: Mode prompt", "bisonModePrompt must be stored in large prompts");

  // 5. 执行读取
  const loadedSettings = await localDB.getStoredSettings();
  assert(loadedSettings !== null, "getStoredSettings should return object");

  // 6. 验证读取合并后的内容是否与原 settings 一致
  assert(loadedSettings.promptConfig.mainPrompt === "SYSTEM: Hello World", "Merged mainPrompt matches");
  assert(loadedSettings.promptConfig.reasoningGuidancePrompt === "REASON: Think step-by-step", "Merged reasoningGuidancePrompt matches");
  assert(loadedSettings.bisonModePrompt === "BISON: Mode prompt", "Merged bisonModePrompt matches");
  assert(loadedSettings.otherOption === "enabled", "Merged otherOption matches");

  // 7. 还原 global 状态
  (global as any).indexedDB = originalIndexedDB;

  console.log("✔ localDB settings Split-Track Storage and Merge verified successfully!");
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
