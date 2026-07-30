/**
 * localDB P0 修复回归测试套件
 *
 * 覆盖 2026-07-25 多方审核发现的两项 P0 缺陷修复：
 *
 *  - testCoalescedWriteAbortNoHang：
 *      P0 #1 合并写 abort 后第一调用方挂起 15s
 *      场景：同 key 两次写合并，第二调用方 signal abort → transaction.abort() → onabort
 *      旧实现 onabort 因 ctx.aborted 短路 return，第一调用方 Promise 永不 settle，等 15s 超时
 *      修复后 onabort 无条件 reject，第一调用方立即收到 rejection
 *
 *  - testGetStoredSettingsAsyncExceptionSafety：
 *      P0 #2 reqLarge.onsuccess 异步异常逃逸
 *      场景：user_settings_large_prompts 返回异常对象，拼装逻辑抛异常
 *      旧实现 try/catch 仅包裹 crypto，异常逃逸为 unhandled rejection，Promise 永久 pending
 *      修复后外层 try/catch 兜底 safeReject，Promise 一定 settle
 *
 * 设计遵循 AGENTS.md `CHANGE-SAFE`：所有测试仅消费导出接口，Mock IDB 通过 global 注入。
 */

import { CharacterCard } from "../../src/types";
import { assert } from "./testUtils";

// ──────────────────────────────────────────────────────────────────────────────
// Mock IDB 工具（扩展自 abortSignalConduction.test.ts，支持按 key 返回不同 get 结果）
// ──────────────────────────────────────────────────────────────────────────────

interface MockStoreConfig {
  /** 按 key 返回 get 的 result；未配置的 key 返回 undefined */
  getResults?: Record<string, unknown>;
  /** true：put/delete 的 onsuccess 永不触发，模拟挂起事务 */
  hang?: boolean;
  /** transaction.abort() 被调用时的回调 */
  onAbortCallback?: () => void;
}

/**
 * 构造支持按 key 返回不同 get 结果的 Mock IDBTransaction。
 *
 * 与 abortSignalConduction.test.ts 的 buildMockTransaction 区别：
 *  - get(key) 根据 getResults[key] 返回特定值（用于 settings 分轨存储测试）
 *  - 保留 hang / onAbortCallback 语义，便于复用合并写挂起场景
 */
function buildMockTransactionWithConfig(opts: MockStoreConfig = {}) {
  let abortCalled = false;
  let oncompleteTimer: ReturnType<typeof setTimeout> | undefined;

  const fireSuccess = (req: { onsuccess?: () => void }) => {
    if (!opts.hang) {
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
    }
  };
  const scheduleOncomplete = () => {
    if (opts.hang) return;
    if (oncompleteTimer) clearTimeout(oncompleteTimer);
    oncompleteTimer = setTimeout(() => {
      if (abortCalled) return;
      if (tx.oncomplete) tx.oncomplete(new Event("complete"));
    }, 0);
  };

  const store = {
    get: (key: string) => {
      const req: { onsuccess?: () => void; result?: unknown } = {
        result: opts.getResults?.[key],
      };
      fireSuccess(req);
      // get 不触发 oncomplete（生产 IDB 中 oncomplete 在所有请求入队后由事务提交触发）
      // 但为了让单事务单请求场景也能 settle，仍调度 oncomplete
      scheduleOncomplete();
      return req;
    },
    put: (_value: unknown, _key?: string) => {
      const req: { onsuccess?: () => void } = {};
      fireSuccess(req);
      scheduleOncomplete();
      return req;
    },
    delete: (_key: string) => {
      const req: { onsuccess?: () => void } = {};
      fireSuccess(req);
      scheduleOncomplete();
      return req;
    },
  };

  const tx: {
    objectStore: () => typeof store;
    abort: () => void;
    onabort: ((ev: Event) => void) | null;
    oncomplete: ((ev: Event) => void) | null;
    onerror: ((ev: Event) => void) | null;
    error: unknown;
  } = {
    objectStore: () => store,
    abort: () => {
      if (abortCalled) return;
      abortCalled = true;
      if (oncompleteTimer) clearTimeout(oncompleteTimer);
      setTimeout(() => {
        if (tx.onabort) tx.onabort(new Event("abort"));
        opts.onAbortCallback?.();
      }, 0);
    },
    onabort: null,
    oncomplete: null,
    onerror: null,
    error: null,
  };
  return tx;
}

/**
 * 注入 Mock indexedDB，返回恢复函数。
 * 调用方应在 finally 中调用恢复函数以还原 global 状态。
 */
function injectMockIDB(
  mockDb: { transaction: () => ReturnType<typeof buildMockTransactionWithConfig> },
  openDelayMs = 0
): () => void {
  const originalIndexedDB = (global as unknown as { indexedDB: IDBFactory }).indexedDB;
  (global as unknown as { indexedDB: IDBFactory }).indexedDB = {
    open: () => {
      const request: { onsuccess?: () => void; onerror?: () => void; result?: unknown } = {};
      setTimeout(() => {
        request.result = mockDb;
        if (request.onsuccess) request.onsuccess();
      }, openDelayMs);
      return request;
    },
  } as unknown as IDBFactory;
  return () => {
    (global as unknown as { indexedDB: IDBFactory }).indexedDB = originalIndexedDB;
  };
}

/** 构造最小合法 CharacterCard */
function buildMinimalCharacter(id: string, name: string): CharacterCard {
  return {
    id,
    name,
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
  };
}

/** 捕获 Promise rejection 的错误对象 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 1：P0 #1 合并写 abort 后第一调用方不应挂起 15s
// ──────────────────────────────────────────────────────────────────────────────

export async function testCoalescedWriteAbortNoHang() {
  console.log("\n--- Running Coalesced Write Abort No-Hang Verification (P0 #1) ---");

  let transactionCreated = false;
  let abortCalled = false;
  const mockTx = buildMockTransactionWithConfig({
    hang: true, // 事务挂起，只能通过 transaction.abort() 终结
    onAbortCallback: () => { abortCalled = true; },
  });
  const mockDb = {
    transaction: () => {
      transactionCreated = true;
      return mockTx;
    },
  };

  const localDB = await import("../../src/utils/localDB");
  localDB.__resetDBInstanceForTesting();
  const restore = injectMockIDB(mockDb);

  try {
    const controller2 = new AbortController();

    // 第一调用方：无 externalSignal，同 key（character:coalesce-abort-char）
    // 同步发起后立即入队，slot 进入 pendingKeyedWrites
    const p1 = localDB.saveCharacter(
      buildMinimalCharacter("coalesce-abort-char", "A")
    );

    // 第二调用方：有 externalSignal，同 key（合并到第一调用方的 slot）
    // 必须同步发起：queuedOperation 在微任务中执行时会 delete key，之后发起的写入不会合并
    const p2 = localDB.saveCharacter(
      buildMinimalCharacter("coalesce-abort-char", "B"),
      controller2.signal
    );

    // 预挂 catch：controller2.abort() 会同步触发 onAbort2 reject p2，
    // 若 p2 此时无 catch handler，Node.js 24 默认 --unhandled-rejections=throw 会 fatal exit。
    // 提前挂 catch 避免 unhandled rejection，错误对象稍后在 thrown2 中断言。
    const p2Caught = p2.catch((e) => e);

    // 等待事务真实创建（queuedOperation 已开始执行，slot.operation 已被 p2 替换）
    for (let attempt = 0; attempt < 50 && !transactionCreated; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert(transactionCreated, "Transaction should be created for coalesced write");

    // 记录 abort 前的时间戳
    const abortStart = Date.now();
    controller2.abort();

    // 第一调用方应在 onabort 触发后立即 reject（远小于 15s 超时）
    // 旧实现：onabort 短路 return，p1 只能等 15s timeoutPromise reject
    // 修复后：onabort 无条件 reject，p1 立即 settle
    const thrown1 = await captureRejection(p1);
    const elapsed1 = Date.now() - abortStart;

    assert(thrown1 !== null, "First caller (no signal) should reject after coalesced abort");
    assert(
      elapsed1 < 2000,
      `First caller should reject quickly (<2s), got ${elapsed1}ms — P0 #1: should not wait 15s timeout`
    );

    // 第二调用方也应通过 signal2 收到 rejection
    const thrown2 = await p2Caught;
    assert(thrown2 !== null, "Second caller (with signal) should reject via signal abort");

    // onAbortCallback 在 mock 的 setTimeout(0) 中触发，等一个 macrotask 让其落定
    await new Promise((r) => setTimeout(r, 0));
    assert(abortCalled, "transaction.abort() should be invoked when second caller's signal aborts");

    console.log("✔ Coalesced write abort no-hang verified successfully!");
  } finally {
    restore();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 2：P0 #2 reqLarge.onsuccess 异步异常应被 safeReject 捕获
// ──────────────────────────────────────────────────────────────────────────────

export async function testGetStoredSettingsAsyncExceptionSafety() {
  console.log("\n--- Running getStoredSettings Async Exception Safety Verification (P0 #2) ---");

  // 构造会让拼装逻辑抛异常的场景：
  //   - user_settings 返回一个 settings 对象，其 promptConfig 被 Object.freeze
  //   - user_settings_large_prompts 返回 { mainPrompt: "new value" }
  //   - 拼装时 settings.promptConfig.mainPrompt = large.mainPrompt 抛 TypeError（frozen 对象赋值失败）
  //
  // 旧实现：try/catch 仅包裹 crypto，TypeError 逃逸为 unhandled rejection，
  //         safeResolve/safeReject 均不执行，getStoredSettings 永久 pending
  // 修复后：外层 try/catch 捕获 TypeError，safeReject 兜底
  const frozenPromptConfig = Object.freeze({ mainPrompt: "" });
  const mockTx = buildMockTransactionWithConfig({
    getResults: {
      user_settings: {
        api: {},
        promptConfig: frozenPromptConfig,
      },
      user_settings_large_prompts: {
        mainPrompt: "new value from large",
      },
    },
  });
  const mockDb = {
    transaction: () => mockTx,
  };

  const localDB = await import("../../src/utils/localDB");
  localDB.__resetDBInstanceForTesting();
  const restore = injectMockIDB(mockDb);

  try {
    // 用 Promise.race + 超时兜底，防止修复失效时测试永久挂起
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("test timeout: getStoredSettings did not settle (P0 #2 regression)")), 3000)
    );

    const thrown = await captureRejection(Promise.race([
      localDB.getStoredSettings(),
      timeout,
    ]));

    assert(
      thrown !== null,
      "getStoredSettings should reject when assembly logic throws (P0 #2: must not hang forever)"
    );
    // 验证抛出的异常是 TypeError（frozen 对象赋值失败）
    assert(
      (thrown as { name?: string })?.name === "TypeError",
      `Expected TypeError from frozen assignment, got ${(thrown as { name?: string })?.name}`
    );

    console.log("✔ getStoredSettings async exception safety verified successfully!");
  } finally {
    restore();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 3：路径 C4 — 合并写 + 第一调用方 signal abort，第二调用方无 signal
// ──────────────────────────────────────────────────────────────────────────────

export async function testCoalescedWriteFirstCallerAbort() {
  console.log("\n--- Running Coalesced Write First Caller Abort Verification (Path C4) ---");

  // 路径 C4：合并写 + 第一调用方有 signal1，第二调用方无 signal，第一调用方 abort
  // 验证：两个调用方都应快速收到 rejection（远小于 15s 超时）
  // 关键：第二调用方无 signal，直接返回 existing.pendingPromise，
  //       signal1 abort → onAbort → slot.abortFn() → transaction.abort() → onabort reject（P0 #1 修复）
  //       若 onabort 短路（旧实现），第一调用方通过 signalAbortPromise reject，
  //       但第二调用方依赖 existing.pendingPromise，operation 永不 settle → 等 15s 超时
  let transactionCreated = false;
  let abortCalled = false;
  const mockTx = buildMockTransactionWithConfig({
    hang: true, // 事务挂起，只能通过 transaction.abort() 终结
    onAbortCallback: () => { abortCalled = true; },
  });
  const mockDb = {
    transaction: () => {
      transactionCreated = true;
      return mockTx;
    },
  };

  const localDB = await import("../../src/utils/localDB");
  localDB.__resetDBInstanceForTesting();
  const restore = injectMockIDB(mockDb);

  try {
    const controller1 = new AbortController();

    // 第一调用方：有 signal1，同 key（character:coalesce-first-abort-char）
    const p1 = localDB.saveCharacter(
      buildMinimalCharacter("coalesce-first-abort-char", "A"),
      controller1.signal
    );

    // 第二调用方：无 signal，同 key（合并到第一调用方，直接返回 existing.pendingPromise）
    const p2 = localDB.saveCharacter(
      buildMinimalCharacter("coalesce-first-abort-char", "B")
    );

    // 预挂 catch：controller1.abort() 会同步触发 onAbort reject p1/p2，
    // 若无 catch handler，Node.js 24 默认 --unhandled-rejections=throw 会 fatal exit。
    const p1Caught = p1.catch((e) => e);
    const p2Caught = p2.catch((e) => e);

    // 等待事务真实创建（queuedOperation 已开始执行，slot.operation 已被 p2 替换）
    for (let attempt = 0; attempt < 50 && !transactionCreated; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert(transactionCreated, "Transaction should be created for coalesced write");

    // 记录 abort 前的时间戳
    const abortStart = Date.now();
    controller1.abort();

    // 第一调用方应在 onabort 触发后立即 reject（远小于 15s 超时）
    // 旧实现：onabort 短路 return，p1 通过 signalAbortPromise reject，但 p2 依赖
    //         existing.pendingPromise，operation 永不 settle → p2 等 15s timeoutPromise
    // 修复后：onabort 无条件 reject，operation 立即 settle，p1/p2 都快速收到 rejection
    const thrown1 = await p1Caught;
    const elapsed1 = Date.now() - abortStart;

    assert(thrown1 !== null, "First caller (with signal) should reject after signal abort");
    assert(
      elapsed1 < 2000,
      `First caller should reject quickly (<2s), got ${elapsed1}ms — Path C4: should not wait 15s timeout`
    );

    // 第二调用方也应通过 existing.pendingPromise 收到 rejection
    const thrown2 = await p2Caught;
    assert(thrown2 !== null, "Second caller (no signal) should reject via coalesced pendingPromise");

    // 验证 transaction.abort() 被调用
    await new Promise((r) => setTimeout(r, 0));
    assert(abortCalled, "transaction.abort() should be invoked when first caller's signal aborts");

    console.log("✔ Coalesced write first caller abort verified successfully!");
  } finally {
    restore();
  }
}
