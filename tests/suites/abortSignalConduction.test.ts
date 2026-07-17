/**
 * AbortSignal 协作式中断传导测试套件
 *
 * 验证 TODO #5 落地的三大中断传导机制：
 *  1. localDB 写操作的预 abort / 中途 abort 触发 transaction.abort() 真正释放底层资源
 *  2. mvuParser 复杂正则循环顶部的 aborted 检查点
 *  3. MemoryStreamParser 流式状态机循环的 aborted 检查点
 *
 * 设计遵循 AGENTS.md 准则八（物理隔离）：所有测试仅消费导出接口，不直接触及私有实现。
 * Mock IDB 模式参考 database.test.ts，通过 global.indexedDB 注入桩件。
 */

import { CharacterCard } from "../../src/types";
import { MemoryStreamParser } from "../../src/kernel/services/memory/MemoryStreamParser";
import {
  extractMvuCommands,
  extractXmlMvuCommands,
  detectJsonPatch,
  parseMvuMessage,
  applyCharacterRegexScripts,
} from "../../src/utils/tavernHelper/mvuParser";
import { assert } from "./testUtils";

// ──────────────────────────────────────────────────────────────────────────────
// Mock IDB 工具
// ──────────────────────────────────────────────────────────────────────────────

interface MockTransactionOptions {
  /** true：永远不触发 onsuccess，模拟挂起事务；false：立即触发 onsuccess */
  hang?: boolean;
  /** transaction.abort() 被调用时的回调（用于断言主动 abort 行为） */
  onAbortCallback?: () => void;
}

/**
 * 构造 Mock IDBTransaction，支持挂起模式与 abort 行为追踪。
 * 当 hang=true 时，put/get/delete 的 onsuccess 永不触发，
 * 只能通过 transaction.abort() 终结（触发 onabort 事件）。
 */
function buildMockTransaction(opts: MockTransactionOptions = {}) {
  let abortCalled = false;
  const fireSuccess = (req: { onsuccess?: () => void }) => {
    if (!opts.hang) {
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
    }
  };
  const store = {
    put: (_value: unknown, _key?: string) => {
      const req: { onsuccess?: () => void } = {};
      fireSuccess(req);
      return req;
    },
    get: (_key: string) => {
      const req: { onsuccess?: () => void; result?: unknown } = { result: undefined };
      fireSuccess(req);
      return req;
    },
    delete: (_key: string) => {
      const req: { onsuccess?: () => void } = {};
      fireSuccess(req);
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
    _wasAbortCalled: () => boolean;
  } = {
    objectStore: () => store,
    abort: () => {
      if (abortCalled) return;
      abortCalled = true;
      // 模拟 IDB 行为：abort() 后异步触发 onabort 事件
      setTimeout(() => {
        if (tx.onabort) tx.onabort(new Event("abort"));
        opts.onAbortCallback?.();
      }, 0);
    },
    onabort: null,
    oncomplete: null,
    onerror: null,
    error: null,
    _wasAbortCalled: () => abortCalled,
  };
  return tx;
}

/**
 * 注入 Mock indexedDB，返回恢复函数。
 * 调用方应在 finally 中调用恢复函数以还原 global 状态。
 */
function injectMockIDB(mockDb: { transaction: () => ReturnType<typeof buildMockTransaction> }): () => void {
  const originalIndexedDB = (global as unknown as { indexedDB: IDBFactory }).indexedDB;
  (global as unknown as { indexedDB: IDBFactory }).indexedDB = {
    open: () => {
      const request: { onsuccess?: () => void; onerror?: () => void; result?: unknown } = {};
      setTimeout(() => {
        request.result = mockDb;
        if (request.onsuccess) request.onsuccess();
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;
  return () => {
    (global as unknown as { indexedDB: IDBFactory }).indexedDB = originalIndexedDB;
  };
}

/** 构造最小合法 CharacterCard，避免大量必填字段污染测试断言 */
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

/** 捕获 Promise rejection 的错误对象，避免散落的 try/catch 样板 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 1：预先 abort 的 signal 导致立即 AbortError，不创建事务
// ──────────────────────────────────────────────────────────────────────────────

export async function testAbortSignalPreAbortedLocalDB() {
  console.log("\n--- Running AbortSignal Pre-Aborted LocalDB Verification ---");

  let transactionCreated = false;
  const mockTx = buildMockTransaction();
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
    const controller = new AbortController();
    controller.abort();

    const thrown = await captureRejection(
      localDB.saveCharacter(buildMinimalCharacter("test-char-1", "Test1"), controller.signal)
    );

    assert(thrown !== null, "Pre-aborted signal should cause rejection");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
    assert(
      transactionCreated === false,
      "Pre-aborted signal should NOT create IDB transaction (early short-circuit in enqueueWrite)"
    );

    console.log("✔ AbortSignal pre-aborted localDB verified successfully!");
  } finally {
    restore();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 2：操作中 abort 触发 transaction.abort()
// ──────────────────────────────────────────────────────────────────────────────

export async function testAbortSignalMidOperationLocalDB() {
  console.log("\n--- Running AbortSignal Mid-Operation LocalDB Verification ---");

  let abortCalled = false as boolean;
  const mockTx = buildMockTransaction({
    hang: true,
    onAbortCallback: () => { abortCalled = true; },
  });
  const mockDb = {
    transaction: () => mockTx,
  };

  const localDB = await import("../../src/utils/localDB");
  localDB.__resetDBInstanceForTesting();
  const restore = injectMockIDB(mockDb);

  try {
    const controller = new AbortController();
    const promise = localDB.saveCharacter(
      buildMinimalCharacter("test-char-2", "Test2"),
      controller.signal
    );

    // 让 queuedOperation 进入执行，事务已创建并挂起
    await new Promise((r) => setTimeout(r, 10));

    controller.abort();

    const thrown = await captureRejection(promise);
    // onAbortCallback 在 mock 的 setTimeout(0) 中触发，需等一个 macrotask 让其落定
    await new Promise((r) => setTimeout(r, 0));

    assert(thrown !== null, "Mid-operation abort should cause rejection");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
    assert(
      abortCalled === true,
      "transaction.abort() should be invoked by registerAbort callback when signal aborts"
    );

    console.log("✔ AbortSignal mid-operation localDB verified successfully!");
  } finally {
    restore();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 3：abort 后写队列恢复（验证 bindTransactionAbort 短路 + 队列不阻塞）
// ──────────────────────────────────────────────────────────────────────────────

export async function testAbortSignalWriteQueueRecovery() {
  console.log("\n--- Running AbortSignal Write Queue Recovery Verification ---");

  let firstAbortCalled = false as boolean;
  const hangingTx = buildMockTransaction({
    hang: true,
    onAbortCallback: () => { firstAbortCalled = true; },
  });
  const normalTx = buildMockTransaction({ hang: false });

  let callCount = 0;
  const mockDb = {
    transaction: () => {
      callCount++;
      return callCount === 1 ? hangingTx : normalTx;
    },
  };

  const localDB = await import("../../src/utils/localDB");
  localDB.__resetDBInstanceForTesting();
  const restore = injectMockIDB(mockDb);

  try {
    const controller = new AbortController();

    // 第一次写入：挂起 + abort
    const p1 = localDB.saveCharacter(
      buildMinimalCharacter("test-char-3a", "A"),
      controller.signal
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    const thrown = await captureRejection(p1);
    // onAbortCallback 在 mock 的 setTimeout(0) 中触发，需等一个 macrotask 让其落定
    await new Promise((r) => setTimeout(r, 0));
    assert(thrown !== null, "First (hanging) write should reject on abort");
    assert(firstAbortCalled === true, "First transaction.abort() should be called");

    // 第二次写入：应能正常完成（写队列未永久阻塞）
    await localDB.saveCharacter(buildMinimalCharacter("test-char-3b", "B"));
    assert(
      callCount === 2,
      `Second write should create new transaction, callCount=${callCount}`
    );

    console.log("✔ AbortSignal write queue recovery verified successfully!");
  } finally {
    restore();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 4：MVU 解析器循环顶部 aborted 检查点
// ──────────────────────────────────────────────────────────────────────────────

export async function testMvuParserAbortedCheckpoints() {
  console.log("\n--- Running MVU Parser Aborted Checkpoints Verification ---");

  // 4.1 extractMvuCommands
  {
    const controller = new AbortController();
    controller.abort();
    const longText = '_.set("hp", 80); '.repeat(1000);
    const thrown = await captureRejection(
      Promise.resolve().then(() => extractMvuCommands(longText, controller.signal))
    );
    assert(thrown !== null, "extractMvuCommands should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 4.2 extractXmlMvuCommands
  {
    const controller = new AbortController();
    controller.abort();
    const xmlText = "<UpdateVariable>_.set(\"hp\", 80);</UpdateVariable>".repeat(100);
    const thrown = await captureRejection(
      Promise.resolve().then(() => extractXmlMvuCommands(xmlText, controller.signal))
    );
    assert(thrown !== null, "extractXmlMvuCommands should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 4.3 detectJsonPatch
  {
    const controller = new AbortController();
    controller.abort();
    const jsonPatchText = '<JSONPatch>[{"op":"replace","path":"/hp","value":80}]</JSONPatch>'.repeat(100);
    const thrown = await captureRejection(
      Promise.resolve().then(() => detectJsonPatch(jsonPatchText, controller.signal))
    );
    assert(thrown !== null, "detectJsonPatch should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 4.4 parseMvuMessage
  {
    const controller = new AbortController();
    controller.abort();
    const text = '_.set("hp", 80); '.repeat(100);
    const thrown = await captureRejection(
      Promise.resolve().then(() =>
        parseMvuMessage(text, { stat_data: { hp: 100 } }, controller.signal)
      )
    );
    assert(thrown !== null, "parseMvuMessage should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 4.5 applyCharacterRegexScripts
  {
    const controller = new AbortController();
    controller.abort();
    const character = {
      name: "Test",
      extensions: {
        regex_scripts: Array.from({ length: 50 }, (_, i) => ({
          scriptName: `script-${i}`,
          findRegex: "foo",
          replaceString: "bar",
          disabled: false,
        })),
      },
    };
    const thrown = await captureRejection(
      Promise.resolve().then(() =>
        applyCharacterRegexScripts(
          "foo ".repeat(50),
          character,
          true,
          undefined,
          undefined,
          "store",
          controller.signal
        )
      )
    );
    assert(thrown !== null, "applyCharacterRegexScripts should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 4.6 回归：正常路径不抛出且产出正确
  {
    const result = extractMvuCommands('_.set("hp", 80); _.add("gold", -50);');
    assert(result.length === 2, `Expected 2 commands, got ${result.length}`);
    assert(result[0].type === "set", "First command should be set");
    assert(result[1].type === "add", "Second command should be add");
  }

  {
    const result = parseMvuMessage('_.set("hp", 50);', { stat_data: { hp: 100 } });
    assert(
      result.stat_data.hp === 50,
      `Expected hp=50 after set, got ${result.stat_data.hp}`
    );
  }

  console.log("✔ MVU parser aborted checkpoints verified successfully!");
}

// ──────────────────────────────────────────────────────────────────────────────
// 测试 5：MemoryStreamParser 流式状态机 aborted 检查点
// ──────────────────────────────────────────────────────────────────────────────

export async function testMemoryStreamParserAbort() {
  console.log("\n--- Running MemoryStreamParser Abort Verification ---");

  // 5.1 在循环顶部抛出 AbortError
  {
    const parser = new MemoryStreamParser();
    const controller = new AbortController();
    controller.abort();

    // 构造会进入 while 循环的 chunk（buffer 非空）
    const longChunk = "x".repeat(100) + "<memory>long content</memory>".repeat(10);
    const thrown = await captureRejection(
      Promise.resolve().then(() => parser.onChunk(longChunk, controller.signal))
    );
    assert(thrown !== null, "onChunk should throw on aborted signal");
    assert(
      (thrown as { name?: string })?.name === "AbortError",
      `Expected AbortError, got ${(thrown as { name?: string })?.name}`
    );
  }

  // 5.2 回归：正常路径不抛出且正确剥离 <memory> 标签
  {
    const parser = new MemoryStreamParser();
    const result = parser.onChunk("hello <memory>secret</memory> world");
    assert(
      result.displayText === "hello  world",
      `Expected "hello  world", got "${result.displayText}"`
    );
    assert(
      result.memoryContent === "secret",
      `Expected memory content "secret", got "${result.memoryContent}"`
    );
  }

  // 5.3 回归：跨 chunk 的标签拼接
  {
    const parser = new MemoryStreamParser();
    const r1 = parser.onChunk("text <mem");
    assert(r1.displayText === "text ", `Expected "text ", got "${r1.displayText}"`);

    const r2 = parser.onChunk("ory>secret</memory> tail");
    assert(r2.displayText === " tail", `Expected " tail", got "${r2.displayText}"`);
    assert(
      r2.memoryContent === "secret",
      `Expected memory content "secret", got "${r2.memoryContent}"`
    );
  }

  console.log("✔ MemoryStreamParser abort verified successfully!");
}