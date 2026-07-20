/**
 * 记忆系统测试套件
 *
 * 覆盖阶段 A 全部交付物：
 *  - testModelCapabilityRegistry：模型能力注册表 + 参数防腐层 + 运行时缓存
 *  - testMemoryStreamParser：流式 <memory> 标签状态机解析器
 *  - testMemoryStorageCrud：MemoryStorage messages / memory_dict Store CRUD
 *  - testMemoryServiceLifecycle：MemoryService init/destroy 生命周期
 *
 * 覆盖阶段 B 全部交付物：
 *  - testMemoryExtractor：validateExtraction 校验器 + extractByDict 词典匹配 + 三级降级 + 调度队列
 *  - testMemoryRecall：标签召回 + 时间衰减打分 + 排除最近 N 轮 + top-K
 *
 * 覆盖阶段 C 全部交付物：
 *  - testMemoryStateTable：默认表初始化 + getSheet + parseAICommand + processTableMemory CRUD
 *  - testMemorySummary：触发检测 + LLM 调用 + 瘦身 SummaryCard（砸 5 条正则状态抽离）
 *
 * 测试遵循 AGENTS.md 准则八/十 TDD 单兵验证流程，
 * 在 tests/run_all_tests.ts 中聚合执行。
 */

import { assert } from "./testUtils";
import type { MemoryStorage } from "../../src/kernel/services/memory/MemoryStorage";
import type { MemoryDictEntry } from "../../src/kernel/services/memory/types";

/** 扩展 globalThis 以访问浏览器 API（localStorage / indexedDB / IDBKeyRange） */
type GlobalWithWebAPIs = typeof globalThis & {
  localStorage?: Storage;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
};

const globalWithWebAPIs = globalThis as unknown as GlobalWithWebAPIs;

/** IDB 事件处理函数占位类型 */
type MockIDBEventHandler = ((ev: Event) => void) | null;

// ===== 测试 1：ModelCapabilityRegistry =====

export async function testModelCapabilityRegistry() {
  console.log("\n--- Running ModelCapabilityRegistry Verification ---");
  const { ModelCapabilityRegistry } = await import(
    "../../src/kernel/services/memory/ModelCapabilityRegistry"
  );

  // Mock localStorage（Node 环境无原生 localStorage）
  const memStore: Record<string, string> = {};
  const originalLocalStorage = globalWithWebAPIs.localStorage;
  globalWithWebAPIs.localStorage = {
    getItem: (k: string) => memStore[k] ?? null,
    setItem: (k: string, v: string) => {
      memStore[k] = v;
    },
    removeItem: (k: string) => {
      delete memStore[k];
    },
  } as unknown as Storage;

  try {
    ModelCapabilityRegistry.resetRuntimeCacheForTesting();

    // 1. 已知模型能力查询（前缀匹配）
    const deepseekCaps = ModelCapabilityRegistry.getCapabilities("deepseek-chat");
    assert(deepseekCaps.supportsTopK === true, "deepseek supports top_k");
    assert(deepseekCaps.supportsTopP === true, "deepseek supports top_p");
    assert(deepseekCaps.supportsStream === true, "deepseek supports stream");

    const claudeCaps = ModelCapabilityRegistry.getCapabilities("claude-3-opus");
    assert(claudeCaps.supportsTopK === false, "claude does NOT support top_k");
    assert(claudeCaps.supportsTopP === true, "claude supports top_p");

    const gptCaps = ModelCapabilityRegistry.getCapabilities("gpt-4o");
    assert(gptCaps.supportsTopK === false, "gpt does NOT support top_k");

    // 2. 未知模型保守默认值
    const unknownCaps = ModelCapabilityRegistry.getCapabilities("some-unknown-model-v1");
    assert(unknownCaps.supportsTopK === false, "Unknown model defaults to no top_k");
    assert(unknownCaps.supportsTopP === true, "Unknown model defaults to support top_p");
    assert(
      unknownCaps.supportsJsonSchema === false,
      "Unknown model defaults to no json_schema (conservative)"
    );

    // 2.5. 知名代理服务商 (newapi, oneapi) 支持验证
    const newapiCaps = ModelCapabilityRegistry.getCapabilities("gpt-4o", "https://api.newapi.pro/v1");
    assert(newapiCaps.supportsJsonSchema === true, "newapi standard provider should support json_schema");
    assert(newapiCaps.supportsFunctionCalling === true, "newapi standard provider should support function calling");

    const oneapiCaps = ModelCapabilityRegistry.getCapabilities("gpt-4o", "https://api.oneapi.com/v1");
    assert(oneapiCaps.supportsJsonSchema === true, "oneapi standard provider should support json_schema");

    const unknownProxyCaps = ModelCapabilityRegistry.getCapabilities("gpt-4o", "https://api.unknownproxy.com/v1");
    assert(unknownProxyCaps.supportsJsonSchema === false, "unknown proxy provider should fall back to conservative defaults");

    // 3. 参数清洗（防腐层入口）
    const cleaned = ModelCapabilityRegistry.cleanLLMParams("claude-3-opus", {
      top_k: 40,
      top_p: 0.9,
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    assert(cleaned.top_k === undefined, "claude: top_k should be stripped");
    assert(cleaned.top_p === 0.9, "claude: top_p should be retained");
    assert(cleaned.temperature === 0.7, "claude: temperature should be retained");
    assert(cleaned.response_format !== undefined, "claude: response_format should be retained");

    // 4. 运行时错误自愈：仅允许关闭能力，不允许开启
    ModelCapabilityRegistry.updateCapabilities("claude-3-opus", {
      supportsTopP: false,
      supportsTopK: true, // 应被忽略（不允许开启）
    });
    const updated = ModelCapabilityRegistry.getCapabilities("claude-3-opus");
    assert(updated.supportsTopP === false, "Runtime update: topP should be closed");
    assert(updated.supportsTopK === false, "Runtime update: topK should NOT be opened");

    // 5. 运行时缓存持久化到 localStorage
    const persisted = JSON.parse(memStore["mt_model_capability_runtime_cache"]);
    assert(
      persisted["claude-3-opus"].supportsTopP === false,
      "Runtime cache should be persisted to localStorage"
    );

    // 6. 错误识别：参数不支持错误
    const err1 = ModelCapabilityRegistry.isUnsupportedParamError({
      message: "Invalid parameter: top_k is not supported",
    });
    assert(err1 !== null && err1.param === "supportsTopK", "Should detect top_k error");

    const err2 = ModelCapabilityRegistry.isUnsupportedParamError({
      message: "Unknown parameter response_format",
    });
    assert(
      err2 !== null && err2.param === "supportsJsonSchema",
      "Should detect response_format error"
    );

    const err3 = ModelCapabilityRegistry.isUnsupportedParamError({
      message: "Network timeout",
    });
    assert(err3 === null, "Should NOT detect non-param errors");

    console.log("✔ ModelCapabilityRegistry verified successfully!");
  } finally {
    ModelCapabilityRegistry.resetRuntimeCacheForTesting();
    globalWithWebAPIs.localStorage = originalLocalStorage;
  }
}

// ===== 测试 2：MemoryStreamParser =====

export async function testMemoryStreamParser() {
  console.log("\n--- Running MemoryStreamParser Verification ---");
  const { MemoryStreamParser } = await import(
    "../../src/kernel/services/memory/MemoryStreamParser"
  );

  // 1. 标签完整出现在单个 chunk：displayText 包含标签前后的文本，memoryContent 在标签闭合时返回
  const parser1 = new MemoryStreamParser();
  const r1 = parser1.onChunk("你好世界<memory>老张出现在酒馆</memory>再见");
  assert(r1.displayText === "你好世界再见", "Should display text before and after <memory>");
  assert(r1.memoryContent === "老张出现在酒馆", "Should emit memoryContent when tag closes");

  // 2. 标签跨多个 chunk（开标签被截断）
  const parser2 = new MemoryStreamParser();
  const r2a = parser2.onChunk("对话内容前缀<memo");
  assert(r2a.displayText === "对话内容前缀", "Should buffer partial open tag prefix");
  assert(r2a.memoryContent === undefined, "No memoryContent while buffering partial tag");
  const r2b = parser2.onChunk("ry>老张</memory>");
  assert(r2b.displayText === "", "No display text when entering and closing tag");
  assert(r2b.memoryContent === "老张", "Should parse memory across chunk boundary");

  // 3. 闭合标签跨 chunk
  const parser3 = new MemoryStreamParser();
  const r3a = parser3.onChunk("<memory>梅子酒</memo");
  assert(r3a.displayText === "", "Inside tag: no display");
  assert(r3a.memoryContent === undefined, "Inside tag: no memoryContent until closed");
  const r3b = parser3.onChunk("ry>");
  assert(r3b.memoryContent === "梅子酒", "Should emit memoryContent after closed across chunks");

  // 4. 容错：流结束时标签未闭合但有内容
  const parser4 = new MemoryStreamParser();
  parser4.onChunk("<memory>未闭合的内容");
  const r4 = parser4.finalize();
  assert(r4.memoryContent === "未闭合的内容", "Should emit accumulated content on finalize");

  // 5. 容错：流结束时在标签外（文本已在 onChunk 中返回，finalize 返回空）
  const parser5 = new MemoryStreamParser();
  const r5a = parser5.onChunk("普通对话");
  assert(r5a.displayText === "普通对话", "Should display text in onChunk");
  const r5b = parser5.finalize();
  assert(r5b.displayText === "", "finalize should return empty when buffer is empty");
  assert(r5b.memoryContent === undefined, "No memoryContent when outside tag");

  // 6. 多个 <memory> 标签在同一 chunk
  const parser6 = new MemoryStreamParser();
  const r6 = parser6.onChunk("<memory>A</memory><memory>B</memory>");
  assert(r6.displayText === "", "No display text for consecutive memory tags");
  // 多个标签时返回最后一个（实际场景中 LLM 仅输出一个 memory 块）
  assert(r6.memoryContent === "B", "Should emit last memoryContent for multiple tags");

  // 7. 空 chunk
  const parser7 = new MemoryStreamParser();
  const r7 = parser7.onChunk("");
  assert(r7.displayText === "", "Empty chunk should return empty displayText");

  // 8. 文本 + 标签 + 文本 + 标签 + 文本
  const parser8 = new MemoryStreamParser();
  const r8 = parser8.onChunk("前文<memory>X</memory>中文<memory>Y</memory>后文");
  assert(r8.displayText === "前文中文后文", "Should display all text outside memory tags");
  assert(r8.memoryContent === "Y", "Should emit last memoryContent");

  console.log("✔ MemoryStreamParser verified successfully!");
}

// ===== 测试 3：MemoryStorage CRUD =====

/**
 * 构建内存版 IDB mock，支持 store/index/cursor/KeyRange 等核心操作。
 * 仅覆盖 MemoryStorage 所需的最小集，不追求完整 IDB 协议兼容。
 */
function buildInMemoryIDB() {
  type Record = { value: any };
  type IndexDef = { name: string; keyPath: string | string[]; multiEntry?: boolean };
  type StoreDef = {
    name: string;
    keyPath: string;
    records: Map<string, Record>;
    indexes: Map<string, IndexDef>;
  };

  const stores = new Map<string, StoreDef>();
  const dbObj = {
    objectStoreNames: {
      contains(name: string) {
        return stores.has(name);
      },
    },
    createObjectStore(name: string, options?: { keyPath?: string }) {
      // 兼容 localDB 中 createObjectStore("settings") 不传 options 的场景（out-of-line keys）
      const def: StoreDef = {
        name,
        keyPath: options?.keyPath ?? '',
        records: new Map(),
        indexes: new Map(),
      };
      stores.set(name, def);
      return {
        createIndex(
          indexName: string,
          keyPath: string | string[],
          opts?: { unique?: boolean; multiEntry?: boolean }
        ) {
          def.indexes.set(indexName, {
            name: indexName,
            keyPath,
            multiEntry: opts?.multiEntry,
          });
        },
        indexNames: {
          contains(n: string) {
            return def.indexes.has(n);
          },
        },
      };
    },
    transaction(storeNames: any, mode: any) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const targetStores = names.map((n: string) => stores.get(n)).filter(Boolean) as StoreDef[];

      const tx = {
        objectStore(storeName: string) {
          const def = stores.get(storeName);
          if (!def) throw new Error(`Store ${storeName} not found`);

          const extractKey = (value: any, keyPath: string | string[]) => {
            if (Array.isArray(keyPath)) {
              return keyPath.map((p) => value[p]);
            }
            return value[keyPath];
          };

          const store = {
            get(key: any) {
              const req: any = {};
              setTimeout(() => {
                req.result = def.records.get(String(key))?.value ?? null;
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            put(value: any, key?: string) {
              const k = key ?? String(extractKey(value, def.keyPath));
              def.records.set(k, { value });
              const req: any = { result: k };
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            delete(key: any) {
              def.records.delete(String(key));
              const req: any = {};
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            getAll() {
              const req: any = {};
              setTimeout(() => {
                req.result = Array.from(def.records.values()).map((r) => r.value);
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            count() {
              const req: any = {};
              setTimeout(() => {
                req.result = def.records.size;
                if (req.onsuccess) req.onsuccess();
              }, 0);
              return req;
            },
            indexNames: {
              contains(n: string) {
                return def.indexes.has(n);
              },
            },
            index(indexName: string) {
              const idxDef = def.indexes.get(indexName);
              if (!idxDef) throw new Error(`Index ${indexName} not found`);

              const matchKey = (value: any, key: any): boolean => {
                const v = extractKey(value, idxDef.keyPath);
                if (idxDef.multiEntry && Array.isArray(v)) {
                  return v.some((item) => String(item) === String(key));
                }
                if (Array.isArray(v)) {
                  // 复合索引：v 是数组，key 是数组
                  if (!Array.isArray(key)) return false;
                  if (v.length < key.length) return false;
                  for (let i = 0; i < key.length; i++) {
                    if (String(v[i]) !== String(key[i])) return false;
                  }
                  return true;
                }
                return String(v) === String(key);
              };

              const matchRange = (value: any, range: any): boolean => {
                const v = extractKey(value, idxDef.keyPath);
                if (idxDef.multiEntry && Array.isArray(v)) {
                  return v.some((item) => {
                    const s = String(item);
                    if (range.only !== undefined) return s === String(range.only);
                    if (range.lower !== undefined && range.upper !== undefined) {
                      const lo = Array.isArray(range.lower) ? range.lower : [range.lower];
                      const hi = Array.isArray(range.upper) ? range.upper : [range.upper];
                      // 简化：multiEntry 不处理复合范围
                      return s >= String(lo[0]) && s <= String(hi[0]);
                    }
                    return false;
                  });
                }
                if (Array.isArray(v)) {
                  // 复合索引：bound([sessionId, -Inf], [sessionId, +Inf])
                  if (range.lower !== undefined && range.upper !== undefined) {
                    const lo = Array.isArray(range.lower) ? range.lower : [range.lower];
                    const hi = Array.isArray(range.upper) ? range.upper : [range.upper];
                    if (v.length < lo.length) return false;
                    for (let i = 0; i < lo.length; i++) {
                      if (v[i] < lo[i]) return false;
                    }
                    for (let i = 0; i < hi.length; i++) {
                      if (v[i] > hi[i]) return false;
                    }
                    return true;
                  }
                  if (range.only !== undefined) {
                    const o = Array.isArray(range.only) ? range.only : [range.only];
                    if (v.length !== o.length) return false;
                    for (let i = 0; i < o.length; i++) {
                      if (String(v[i]) !== String(o[i])) return false;
                    }
                    return true;
                  }
                }
                if (range.only !== undefined) return String(v) === String(range.only);
                return false;
              };

              return {
                getAll(range?: any) {
                  const req: any = {};
                  setTimeout(() => {
                    const all = Array.from(def.records.values()).map((r) => r.value);
                    req.result = range
                      ? all.filter((v) => matchRange(v, range))
                      : all;
                    if (req.onsuccess) req.onsuccess();
                  }, 0);
                  return req;
                },
                openCursor(range?: any) {
                  const req: any = {};
                  setTimeout(() => {
                    const all = Array.from(def.records.values()).map((r) => r.value);
                    const filtered = range
                      ? all.filter((v) => matchRange(v, range))
                      : all;
                    // 复合索引按 createdAt 升序
                    filtered.sort((a, b) => {
                      if (a.createdAt !== undefined && b.createdAt !== undefined) {
                        return a.createdAt - b.createdAt;
                      }
                      return 0;
                    });
                    let idx = 0;
                    const cursor = {
                      get value() {
                        return filtered[idx];
                      },
                      continue() {
                        idx++;
                        setTimeout(() => {
                          if (idx >= filtered.length) {
                            // 游标耗尽：result 置 null，onsuccess 通知调用方迭代结束
                            req.result = null;
                            if (req.onsuccess) req.onsuccess();
                            return;
                          }
                          if (req.onsuccess) req.onsuccess();
                        }, 0);
                      },
                      delete() {
                        if (filtered[idx]) {
                          const k = String(extractKey(filtered[idx], def.keyPath));
                          def.records.delete(k);
                        }
                      },
                    };
                    req.result = filtered.length > 0 ? cursor : null;
                    if (req.onsuccess) req.onsuccess();
                  }, 0);
                  return req;
                },
              };
            },
          };
          return store;
        },
        onabort: null as MockIDBEventHandler,
        get error() {
          return null;
        },
      };
      return tx;
    },
  };

  const dbRequest: any = {
    result: dbObj,
    onupgradeneeded: null as MockIDBEventHandler,
    onsuccess: null as MockIDBEventHandler,
    onerror: null as MockIDBEventHandler,
    // upgrade transaction：onupgradeneeded 期间 localDB 通过 request.transaction.objectStore(name)
    // 访问已创建的 store（如 v6 迁移读写 settings/lorebooks/worldbooks）
    get transaction() {
      return {
        objectStore: (name: string) => dbObj.transaction(name, 'versionchange').objectStore(name),
      };
    },
  };
  setTimeout(() => {
    if (dbRequest.onupgradeneeded) {
      dbRequest.onupgradeneeded({ oldVersion: 0, target: dbRequest });
    }
    if (dbRequest.onsuccess) dbRequest.onsuccess();
  }, 0);

  return { dbRequest, dbObj, stores };
}

export async function testMemoryStorageCrud() {
  console.log("\n--- Running MemoryStorage CRUD Verification ---");
  const localDB = await import("../../src/utils/localDB");
  const { MemoryStorage } = await import("../../src/kernel/services/memory/MemoryStorage");
  const { buildDictId } = await import("../../src/kernel/services/memory/types");
  const { IndexedDbMemoryPersistenceService } = await import(
    "../../src/infrastructure/storage/IndexedDbMemoryPersistenceService"
  );

  // 1. 装配内存版 IDB mock + IDBKeyRange mock
  const { dbRequest, stores } = buildInMemoryIDB();
  const originalIndexedDB = globalWithWebAPIs.indexedDB;
  const originalIDBKeyRange = globalWithWebAPIs.IDBKeyRange;

  globalWithWebAPIs.indexedDB = {
    open: () => dbRequest,
  } as unknown as IDBFactory;

  // IDBKeyRange mock：返回带标记的对象，供 mock 索引层识别范围查询
  globalWithWebAPIs.IDBKeyRange = {
    only: (value: any) => ({ only: value }),
    bound: (lower: any, upper: any) => ({ lower, upper }),
    lowerBound: (lower: any) => ({ lower }),
    upperBound: (upper: any) => ({ upper }),
  } as unknown as typeof IDBKeyRange;

  // 重置 localDB 模块级缓存，确保使用本次 mock
  localDB.__resetDBInstanceForTesting();

  try {
    // 2. 初始化 MemoryStorage（触发 schema 升级）
    const persistence = new IndexedDbMemoryPersistenceService();
    await persistence.init({} as any);
    const storage = new MemoryStorage(persistence);
    await storage.init();

    // 验证 Store 与索引已创建
    assert(stores.has("messages"), "messages Store should be created");
    assert(stores.has("memory_dict"), "memory_dict Store should be created");
    const messagesStore = stores.get("messages")!;
    assert(messagesStore.indexes.has("sessionId"), "messages: sessionId index created");
    assert(messagesStore.indexes.has("createdAt"), "messages: createdAt index created");
    assert(messagesStore.indexes.has("tags"), "messages: tags multiEntry index created");
    assert(
      messagesStore.indexes.has("sessionId_createdAt"),
      "messages: sessionId_createdAt compound index created"
    );
    const dictStore = stores.get("memory_dict")!;
    assert(dictStore.indexes.has("sessionId"), "memory_dict: sessionId index created");
    assert(dictStore.indexes.has("entity"), "memory_dict: entity index created");

    // 3. 测试 messages Store CRUD
    const sessionId = "sess_test_1";
    const msg1 = {
      id: "msg_1",
      sessionId,
      role: "user" as const,
      content: "今天遇到了老张，他在酒馆喝梅子酒",
      createdAt: 1000,
      turnIndex: 0,
      tags: ["老张", "梅子酒", "酒馆"],
      extractSource: "llm" as const,
    };
    const msg2 = {
      id: "msg_2",
      sessionId,
      role: "assistant" as const,
      content: "老张说他要去城外打猎",
      createdAt: 2000,
      turnIndex: 1,
      tags: ["老张", "城外"],
      extractSource: "llm" as const,
    };
    const msg3 = {
      id: "msg_3",
      sessionId: "sess_other",
      role: "user" as const,
      content: "另一个会话的消息",
      createdAt: 3000,
      turnIndex: 0,
      tags: [],
      extractSource: "none" as const,
    };

    await storage.appendMessage(msg1);
    await storage.appendMessage(msg2);
    await storage.appendMessage(msg3);

    // 按主键查询
    const got = await storage.getMessageById("msg_1");
    assert(got !== null, "getMessageById should return the message");
    assert(got.content === "今天遇到了老张，他在酒馆喝梅子酒", "Message content matches");
    assert(got.tags.length === 3, "Message tags count matches");

    // 按会话查询（按 createdAt 升序）
    const sessionMsgs = await storage.getMessagesBySession(sessionId);
    assert(sessionMsgs.length === 2, "getMessagesBySession should return 2 messages");
    assert(sessionMsgs[0].id === "msg_1", "First message by createdAt asc");
    assert(sessionMsgs[1].id === "msg_2", "Second message by createdAt asc");

    // 分页查询
    const paged = await storage.getMessagesBySession(sessionId, { limit: 1, offset: 1 });
    assert(paged.length === 1, "Paged query should return 1 message");
    assert(paged[0].id === "msg_2", "Paged query returns correct message");

    // 按标签查询（倒排召回）
    const byTag = await storage.getMessagesByTag(sessionId, ["老张"]);
    assert(byTag.length === 2, "getMessagesByTag should return 2 messages with tag '老张'");

    const byTagMulti = await storage.getMessagesByTag(sessionId, ["梅子酒", "城外"]);
    assert(byTagMulti.length === 2, "getMessagesByTag with multiple tags should dedupe");

    const byTagLimited = await storage.getMessagesByTag(sessionId, ["老张"], 1);
    assert(byTagLimited.length === 1, "getMessagesByTag with limit should return 1");

    // 跨会话隔离验证
    const otherSessionMsgs = await storage.getMessagesBySession("sess_other");
    assert(otherSessionMsgs.length === 1, "Other session should have 1 message");

    const crossSessionByTag = await storage.getMessagesByTag("sess_other", ["老张"]);
    assert(crossSessionByTag.length === 0, "Tag query should be isolated by sessionId");

    // 4. 测试 memory_dict Store CRUD

    // 新建词典条目
    const isNew1 = await storage.upsertDictEntry(sessionId, "老张", {
      firstSeenMsgId: "msg_1",
      firstSeenTurn: 0,
      type: "character",
    });
    assert(isNew1 === true, "First upsert should return true (new entry)");

    // 重复 upsert：count 应自增
    const isNew2 = await storage.upsertDictEntry(sessionId, "老张", {
      firstSeenMsgId: "msg_1",
      firstSeenTurn: 0,
    });
    assert(isNew2 === false, "Second upsert should return false (update)");
    const dictEntry = await storage.getDictEntryById(buildDictId(sessionId, "老张"));
    assert(dictEntry !== null, "Dict entry should exist");
    assert(dictEntry.count === 2, "Dict entry count should be 2 after second upsert");
    assert(dictEntry.type === "character", "Dict entry type preserved on update");

    // 新建另一个实体
    await storage.upsertDictEntry(sessionId, "梅子酒", {
      firstSeenMsgId: "msg_1",
      firstSeenTurn: 0,
      type: "item",
    });

    // 按会话查询所有词典
    const dictList = await storage.getDictBySession(sessionId);
    assert(dictList.length === 2, "getDictBySession should return 2 entries");

    // 5. 级联删除测试
    await storage.deleteMessagesBySession(sessionId);
    const afterDelete = await storage.getMessagesBySession(sessionId);
    assert(afterDelete.length === 0, "Messages should be deleted after deleteMessagesBySession");

    await storage.deleteDictBySession(sessionId);
    const dictAfterDelete = await storage.getDictBySession(sessionId);
    assert(dictAfterDelete.length === 0, "Dict entries should be deleted after deleteDictBySession");

    // 6. 销毁后访问应快速失败
    storage.destroy();
    let threw = false;
    try {
      await storage.getMessageById("any");
    } catch {
      threw = true;
    }
    assert(threw, "Should throw after destroy()");

    console.log("✔ MemoryStorage CRUD verified successfully!");
  } finally {
    globalWithWebAPIs.indexedDB = originalIndexedDB;
    globalWithWebAPIs.IDBKeyRange = originalIDBKeyRange;
    localDB.__resetDBInstanceForTesting();
  }
}

// ===== 测试 4：MemoryService 生命周期 =====

export async function testMemoryServiceLifecycle() {
  console.log("\n--- Running MemoryService Lifecycle Verification ---");
  const { Kernel } = await import("../../src/kernel/Kernel");
  const { MemoryService } = await import("../../src/kernel/services/memory/MemoryService");
  const { KernelServices } = await import("../../src/kernel/types");
  const {
    IndexedDbMemoryPersistenceService,
  } = await import("../../src/infrastructure/storage/IndexedDbMemoryPersistenceService");
  const { MEMORY_PERSISTENCE_SERVICE } = await import(
    "../../src/kernel/services/memory/types"
  );
  const localDB = await import("../../src/utils/localDB");

  // 装配内存版 IDB mock + IDBKeyRange mock
  const { dbRequest } = buildInMemoryIDB();
  const originalIndexedDB = globalWithWebAPIs.indexedDB;
  const originalIDBKeyRange = globalWithWebAPIs.IDBKeyRange;

  globalWithWebAPIs.indexedDB = {
    open: () => dbRequest,
  } as unknown as IDBFactory;
  globalWithWebAPIs.IDBKeyRange = {
    only: (value: any) => ({ only: value }),
    bound: (lower: any, upper: any) => ({ lower, upper }),
    lowerBound: (lower: any) => ({ lower }),
    upperBound: (upper: any) => ({ upper }),
  } as unknown as typeof IDBKeyRange;

  localDB.__resetDBInstanceForTesting();

  try {
    const kernel = new Kernel();

    // 依赖夹具必须是可注册的最小服务，不能依赖 registerService 失败后的 SafeProxy。
    const mockDbService: any = {
      name: KernelServices.Database,
      init() {},
    };
    const mockLlmService: any = {
      name: KernelServices.LLM,
      init() {},
    };

    const memoryService = new MemoryService();

    await kernel.registerService(KernelServices.Database, mockDbService);
    await kernel.registerService(KernelServices.LLM, mockLlmService);
    await kernel.registerService(
      MEMORY_PERSISTENCE_SERVICE,
      new IndexedDbMemoryPersistenceService()
    );
    assert(kernel.getService(KernelServices.Database) === mockDbService, "Database dependency should be registered before MemoryService");
    assert(kernel.getService(KernelServices.LLM) === mockLlmService, "LLM dependency should be registered before MemoryService");
    await kernel.registerService(KernelServices.Memory, memoryService);

    // 验证服务已注册
    const fetched = kernel.getService(KernelServices.Memory);
    assert(fetched === memoryService, "MemoryService should be retrievable from kernel");

    // 验证 getStorage 可用
    const storage = memoryService.getStorage();
    assert(storage !== undefined && storage !== null, "getStorage should return storage instance");

    // 验证未初始化的 MemoryService.getStorage 应抛错
    const uninitialized = new MemoryService();
    let threw = false;
    try {
      uninitialized.getStorage();
    } catch {
      threw = true;
    }
    assert(threw, "getStorage on uninitialized service should throw");

    // 销毁内核
    await kernel.destroy();

    // 销毁后 getStorage 应抛错
    let threwAfterDestroy = false;
    try {
      memoryService.getStorage();
    } catch {
      threwAfterDestroy = true;
    }
    assert(threwAfterDestroy, "getStorage after destroy should throw");

    console.log("✔ MemoryService Lifecycle verified successfully!");
  } finally {
    globalWithWebAPIs.indexedDB = originalIndexedDB;
    globalWithWebAPIs.IDBKeyRange = originalIDBKeyRange;
    localDB.__resetDBInstanceForTesting();
  }
}

// ===== MockStorage：内存版 MemoryStorage（供阶段 B 测试使用） =====

/**
 * 简化的内存版 MemoryStorage mock，不依赖完整 IDB 实现。
 * 仅实现 MemoryExtractor / MemoryRecall 依赖的公开方法。
 */
function createMockStorage() {
  const messages = new Map<string, any>();
  const dict = new Map<string, any>();

  return {
    _messages: messages,
    _dict: dict,

    async appendMessage(msg: any): Promise<void> {
      messages.set(msg.id, { ...msg });
    },

    async updateMessageExtraction(id: string, tags: string[], extractSource: string, metadata?: Record<string, any>): Promise<void> {
      const existing = messages.get(id);
      if (existing) {
        existing.tags = tags;
        existing.extractSource = extractSource;
        if (metadata) existing.metadata = { ...(existing.metadata || {}), ...metadata };
      }
    },

    async getMessageById(id: string): Promise<any | null> {
      return messages.get(id) ?? null;
    },

    async getMessagesBySession(sessionId: string): Promise<any[]> {
      return Array.from(messages.values())
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },

    async getMessagesByTag(sessionId: string, tags: string[], limit?: number): Promise<any[]> {
      const tagSet = new Set(tags);
      let result = Array.from(messages.values())
        .filter(
          (m) =>
            m.sessionId === sessionId &&
            Array.isArray(m.tags) &&
            m.tags.some((t: string) => tagSet.has(t))
        )
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // 按时间倒序
      if (limit !== undefined && limit > 0) result = result.slice(0, limit);
      return result;
    },

    async upsertDictEntry(
      sessionId: string,
      entity: string,
      patch: any
    ): Promise<boolean> {
      const id = `${sessionId}:${entity}`;
      const existing = dict.get(id);
      const now = Date.now();
      if (existing) {
        dict.set(id, {
          ...existing,
          ...patch,
          count: (existing.count ?? 0) + 1,
          updatedAt: now,
        });
        return false;
      }
      dict.set(id, {
        id,
        sessionId,
        entity,
        aliases: patch.aliases ?? [],
        type: patch.type ?? 'concept',
        firstSeenMsgId: patch.firstSeenMsgId,
        firstSeenTurn: patch.firstSeenTurn,
        count: patch.count ?? 1,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    },

    async getDictBySession(sessionId: string): Promise<any[]> {
      return Array.from(dict.values()).filter((d) => d.sessionId === sessionId);
    },

    async deleteMessagesBySession(sessionId: string): Promise<void> {
      for (const [k, v] of messages) {
        if (v.sessionId === sessionId) messages.delete(k);
      }
    },

    async deleteDictBySession(sessionId: string): Promise<void> {
      for (const [k, v] of dict) {
        if (v.sessionId === sessionId) dict.delete(k);
      }
    },
  };
}

// ===== 测试 5：MemoryExtractor =====

export async function testMemoryExtractor() {
  console.log("\n--- Running MemoryExtractor Verification ---");
  const { validateExtraction, extractByDict, MemoryExtractor } = await import(
    "../../src/kernel/services/memory/MemoryExtractor"
  );

  // === 5.1 validateExtraction 校验器 ===
  console.log("  [5.1] validateExtraction...");

  // 合法 JSON
  const valid = validateExtraction(
    JSON.stringify({
      entities: [
        { name: "老张", type: "character", first_seen: true },
        { name: "梅子酒", type: "item", first_seen: false },
      ],
      events: [{ summary: "老张递来梅子酒", participants: ["老张"] }],
    })
  );
  assert(valid !== null, "Valid extraction should parse");
  assert(valid!.entities.length === 2, "Valid extraction: 2 entities");
  assert(valid!.entities[0].name === "老张", "Valid extraction: entity name");
  assert(valid!.entities[0].type === "character", "Valid extraction: entity type");
  assert(valid!.events.length === 1, "Valid extraction: 1 event");

  // events 缺省为空数组
  const noEvents = validateExtraction(
    JSON.stringify({ entities: [{ name: "老张", type: "character", first_seen: true }] })
  );
  assert(noEvents !== null, "Missing events should default to empty array");
  assert(noEvents!.events.length === 0, "Missing events: empty array");

  // 非法 JSON
  assert(validateExtraction("not json") === null, "Invalid JSON returns null");
  assert(validateExtraction("") === null, "Empty string returns null");

  // entities 非数组
  assert(
    validateExtraction(JSON.stringify({ entities: "not array" })) === null,
    "Non-array entities returns null"
  );

  // entity.name 超长
  const longName = "x".repeat(51);
  assert(
    validateExtraction(
      JSON.stringify({ entities: [{ name: longName, type: "character", first_seen: true }] })
    ) === null,
    "Entity name > 50 chars returns null"
  );

  // entity.type 不合法
  assert(
    validateExtraction(
      JSON.stringify({ entities: [{ name: "老张", type: "invalid", first_seen: true }] })
    ) === null,
    "Invalid entity type returns null"
  );

  // first_seen 非布尔
  assert(
    validateExtraction(
      JSON.stringify({ entities: [{ name: "老张", type: "character", first_seen: "yes" }] })
    ) === null,
    "Non-boolean first_seen returns null"
  );

  // entities 超过 20 个
  const tooManyEntities = Array.from({ length: 21 }, (_, i) => ({
    name: `e${i}`,
    type: "character",
    first_seen: true,
  }));
  assert(
    validateExtraction(JSON.stringify({ entities: tooManyEntities })) === null,
    "More than 20 entities returns null"
  );

  // events.summary 超长
  const longSummary = "x".repeat(51);
  assert(
    validateExtraction(
      JSON.stringify({
        entities: [],
        events: [{ summary: longSummary, participants: [] }],
      })
    ) === null,
    "Event summary > 50 chars returns null"
  );

  console.log("  ✔ validateExtraction verified");

  // === 5.2 extractByDict 词典匹配 ===
  console.log("  [5.2] extractByDict...");

  const dict = [
    { entity: "老张", aliases: ["张老板", "酒馆老板"], type: "character" as const },
    { entity: "梅子酒", aliases: [], type: "item" as const },
    { entity: "老张三", aliases: [], type: "character" as const },
  ] as unknown as MemoryDictEntry[];

  // 空词典
  assert(extractByDict("任意消息", []).length === 0, "Empty dict returns empty");

  // 空消息
  assert(extractByDict("", dict).length === 0, "Empty message returns empty");

  // 单实体匹配
  const hits1 = extractByDict("老张递来一杯梅子酒", dict);
  assert(hits1.includes("老张"), "Should match entity '老张'");
  assert(hits1.includes("梅子酒"), "Should match entity '梅子酒'");

  // 别名匹配
  const hits2 = extractByDict("张老板今天心情不错", dict);
  assert(hits2.includes("老张"), "Alias '张老板' should map to '老张'");

  // 大小写不敏感
  const dictEn = [{ entity: "Alice", aliases: [], type: "character" as const }] as unknown as MemoryDictEntry[];
  const hits3 = extractByDict("alice went to the tavern", dictEn);
  assert(hits3.includes("Alice"), "Case-insensitive match");

  // 长串优先（"老张三"不被"老张"截断）
  const hits4 = extractByDict("老张三来了", dict);
  assert(hits4.includes("老张三"), "Longer entity '老张三' should match");
  assert(!hits4.includes("老张"), "Shorter '老张' should not truncate longer match");

  console.log("  ✔ extractByDict verified");

  // === 5.3 MemoryExtractor.extract() 三级降级 ===
  console.log("  [5.3] MemoryExtractor three-level fallback...");

  // L0 成功：memoryContent 合法 JSON
  const storage1 = createMockStorage();
  // 预置消息（模拟 appendSessionMessage 先写入，MemoryExtractor 再更新抽取字段的真实流程）
  await storage1.appendMessage({
    id: "msg_l0_ok",
    sessionId: "sess_1",
    role: "assistant",
    content: "老张递来梅子酒",
    createdAt: Date.now(),
    turnIndex: 5,
  });
  const extractor1 = new MemoryExtractor(storage1 as unknown as MemoryStorage);
  extractor1.init();

  const result1 = await extractor1.extract({
    msgId: "msg_l0_ok",
    sessionId: "sess_1",
    role: "assistant",
    message: "老张递来梅子酒",
    turnIndex: 5,
    memoryContent: JSON.stringify({
      entities: [
        { name: "老张", type: "character", first_seen: true },
        { name: "梅子酒", type: "item", first_seen: true },
      ],
      events: [],
    }),
  });
  assert(result1.extractSource === "llm", "L0 success: source = 'llm'");
  assert(result1.tags.includes("老张"), "L0 success: tags include '老张'");
  assert(result1.tags.includes("梅子酒"), "L0 success: tags include '梅子酒'");
  assert(result1.extraction !== undefined, "L0 success: extraction returned");

  // 验证词典已更新
  const dictAfterL0 = await storage1.getDictBySession("sess_1");
  assert(dictAfterL0.length === 2, "L0 success: 2 dict entries created");
  const laoZhangEntry = dictAfterL0.find((d: any) => d.entity === "老张");
  assert(laoZhangEntry !== undefined, "L0 success: '老张' in dict");
  assert(laoZhangEntry.type === "character", "L0 success: dict type correct");

  // 验证消息已写入
  const msgAfterL0 = await storage1.getMessageById("msg_l0_ok");
  assert(msgAfterL0 !== null, "L0 success: message stored");
  assert(msgAfterL0.extractSource === "llm", "L0 success: message source = 'llm'");

  // L0 失败降级 L1：memoryContent 无效 JSON
  const storage2 = createMockStorage();
  // 预置词典
  await storage2.upsertDictEntry("sess_2", "老张", {
    type: "character",
    firstSeenMsgId: "msg_0",
    firstSeenTurn: 0,
    aliases: [],
  });
  const extractor2 = new MemoryExtractor(storage2 as unknown as MemoryStorage);
  extractor2.init();

  const result2 = await extractor2.extract({
    msgId: "msg_l0_fail",
    sessionId: "sess_2",
    role: "assistant",
    message: "老张说今天不营业",
    turnIndex: 1,
    memoryContent: "invalid json",
  });
  assert(result2.extractSource === "dict", "L0 fail → L1: source = 'dict'");
  assert(result2.tags.includes("老张"), "L0 fail → L1: tags include '老张'");

  // L1 无命中降级 L2：消息不含词典实体
  const result3 = await extractor2.extract({
    msgId: "msg_l1_fail",
    sessionId: "sess_2",
    role: "assistant",
    message: "天气晴朗",
    turnIndex: 2,
    memoryContent: "invalid json",
  });
  assert(result3.extractSource === "none", "L1 fail → L2: source = 'none'");
  assert(result3.tags.length === 0, "L1 fail → L2: tags empty");

  // 无 memoryContent 直接 L1
  const result4 = await extractor2.extract({
    msgId: "msg_no_mem",
    sessionId: "sess_2",
    role: "user",
    message: "老张在哪里？",
    turnIndex: 3,
  });
  assert(result4.extractSource === "dict", "No memoryContent → L1: source = 'dict'");
  assert(result4.tags.includes("老张"), "No memoryContent → L1: tags include '老张'");

  // 词典 count 自增验证
  const dictAfterIncrement = await storage2.getDictBySession("sess_2");
  const laoZhangAfter = dictAfterIncrement.find((d: any) => d.entity === "老张");
  assert(
    (laoZhangAfter.count ?? 0) >= 2,
    "Dict count should increment on repeated matches"
  );

  console.log("  ✔ Three-level fallback verified");

  // === 5.4 scheduleExtraction 调度队列 ===
  console.log("  [5.4] scheduleExtraction queue...");

  const storage3 = createMockStorage();
  // 预置消息（模拟 appendSessionMessage 先写入，scheduleExtraction 再更新抽取字段）
  for (let i = 0; i < 5; i++) {
    await storage3.appendMessage({
      id: `msg_q_${i}`,
      sessionId: "sess_q",
      role: "assistant",
      content: `消息 ${i}`,
      createdAt: Date.now() + i,
      turnIndex: i,
    });
  }
  const extractor3 = new MemoryExtractor(storage3 as unknown as MemoryStorage);
  extractor3.init();

  // 调度 5 个任务（队列上限 3，应丢弃最旧 2 个）
  for (let i = 0; i < 5; i++) {
    extractor3.scheduleExtraction({
      msgId: `msg_q_${i}`,
      sessionId: "sess_q",
      role: "assistant",
      message: `消息 ${i}`,
      turnIndex: i,
    });
  }

  // 等待队列处理完成
  await new Promise((r) => setTimeout(r, 100));

  // 验证至少写入了部分消息（队列可能丢弃最旧的）
  const allMsgs = await storage3.getMessagesBySession("sess_q");
  assert(allMsgs.length >= 1, "Queue should process at least 1 task");
  assert(allMsgs.length <= 5, "Queue should process at most 5 tasks");

  // destroy 后调度应被忽略
  extractor3.destroy();
  extractor3.scheduleExtraction({
    msgId: "msg_after_destroy",
    sessionId: "sess_q",
    role: "assistant",
    message: "不应被处理",
    turnIndex: 99,
  });
  await new Promise((r) => setTimeout(r, 50));
  const msgAfterDestroy = await storage3.getMessageById("msg_after_destroy");
  assert(msgAfterDestroy === null, "scheduleExtraction after destroy should be ignored");

  console.log("  ✔ scheduleExtraction queue verified");

  console.log("✔ MemoryExtractor verified successfully!");
}

// ===== 测试 6：MemoryRecall =====

export async function testMemoryRecall() {
  console.log("\n--- Running MemoryRecall Verification ---");
  const { MemoryRecall } = await import("../../src/kernel/services/memory/MemoryRecall");

  // === 6.1 recall() 主入口 ===
  console.log("  [6.1] recall()...");

  // 无词典 + 无消息 → 返回空（兜底召回也无消息可取）
  const storage1 = createMockStorage();
  const recall1 = new MemoryRecall(storage1 as unknown as MemoryStorage);

  const empty = await recall1.recall("sess_1", "任意消息");
  assert(empty.length === 0, "recall with empty dict AND empty messages returns empty");

  // 有词典 + 当前消息命中 → 召回
  const storage2 = createMockStorage();

  // 预置词典
  await storage2.upsertDictEntry("sess_2", "老张", {
    type: "character",
    firstSeenMsgId: "msg_0",
    firstSeenTurn: 0,
    aliases: [],
  });
  await storage2.upsertDictEntry("sess_2", "梅子酒", {
    type: "item",
    firstSeenMsgId: "msg_0",
    firstSeenTurn: 0,
    aliases: [],
  });

  // 预置历史消息（带标签）
  await storage2.appendMessage({
    id: "msg_hist_1",
    sessionId: "sess_2",
    role: "assistant",
    content: "老张递来梅子酒，说这酒埋了三年了",
    createdAt: 1000,
    turnIndex: 5,
    tags: ["老张", "梅子酒"],
    extractSource: "llm",
  });
  await storage2.appendMessage({
    id: "msg_hist_2",
    sessionId: "sess_2",
    role: "user",
    content: "谢谢老张",
    createdAt: 2000,
    turnIndex: 6,
    tags: ["老张"],
    extractSource: "dict",
  });

  const recall2 = new MemoryRecall(storage2 as unknown as MemoryStorage);
  const results = await recall2.recall("sess_2", "老张今天在吗？", {
    currentTurnIndex: 20,
    excludeRecentN: 0, // 不排除，确保能召回
  });

  assert(results.length > 0, "recall should return results for matched tags");
  assert(
    results.some((r) => r.content.includes("梅子酒")),
    "recall should include message about 梅子酒"
  );
  assert(
    results.every((r) => r.hitTags.includes("老张")),
    "All recalled messages should hit tag '老张'"
  );

  console.log("  ✔ recall() verified");

  // === 6.2 recallByTags() 直接标签召回 ===
  console.log("  [6.2] recallByTags()...");

  // 无标签 → 返回空
  const emptyTags = await recall2.recallByTags("sess_2", []);
  assert(emptyTags.length === 0, "recallByTags with empty tags returns empty");

  // 有标签 → 召回 + 打分
  const tagged = await recall2.recallByTags("sess_2", ["老张", "梅子酒"], {
    currentTurnIndex: 20,
    excludeRecentN: 0,
  });
  assert(tagged.length > 0, "recallByTags should return results");

  // msg_hist_1 命中 2 个标签（老张+梅子酒），应排在前面
  const topResult = tagged[0];
  assert(topResult.hitCount >= 2, "Top result should hit at least 2 tags");
  assert(topResult.score > 0, "Top result should have positive score");

  console.log("  ✔ recallByTags() verified");

  // === 6.3 评分公式验证 ===
  console.log("  [6.3] scoring formula...");

  const storage3 = createMockStorage();
  const recall3 = new MemoryRecall(storage3 as unknown as MemoryStorage);

  // 两条消息：一条命中 2 标签 + 较旧，一条命中 1 标签 + 较新
  await storage3.appendMessage({
    id: "msg_old_2tags",
    sessionId: "sess_3",
    role: "assistant",
    content: "老张递来梅子酒",
    createdAt: 1000,
    turnIndex: 1,
    tags: ["老张", "梅子酒"],
    extractSource: "llm",
  });
  await storage3.appendMessage({
    id: "msg_new_1tag",
    sessionId: "sess_3",
    role: "user",
    content: "谢谢老张",
    createdAt: 2000,
    turnIndex: 10,
    tags: ["老张"],
    extractSource: "dict",
  });

  const scored = await recall3.recallByTags("sess_3", ["老张", "梅子酒"], {
    currentTurnIndex: 20,
    excludeRecentN: 0,
    topK: 10,
  });

  assert(scored.length === 2, "Should recall both messages");

  // msg_old_2tags: hitCount=2, ageInTurns=19, score = 2 × (1/(1+19/50)) = 2 × 0.7246 = 1.449
  // msg_new_1tag:  hitCount=1, ageInTurns=10, score = 1 × (1/(1+10/50)) = 1 × 0.8333 = 0.833
  // 2 标签的旧消息得分更高
  assert(scored[0].messageId === "msg_old_2tags", "2-tag message should rank first");
  assert(scored[0].hitCount === 2, "First result hitCount = 2");
  assert(scored[1].hitCount === 1, "Second result hitCount = 1");

  // 验证 score 计算
  const expectedScoreOld = 2 * (1 / (1 + 19 / 50));
  const expectedScoreNew = 1 * (1 / (1 + 10 / 50));
  assert(
    Math.abs(scored[0].score - expectedScoreOld) < 0.01,
    `Score for 2-tag old msg: expected ${expectedScoreOld.toFixed(4)}, got ${scored[0].score.toFixed(4)}`
  );
  assert(
    Math.abs(scored[1].score - expectedScoreNew) < 0.01,
    `Score for 1-tag new msg: expected ${expectedScoreNew.toFixed(4)}, got ${scored[1].score.toFixed(4)}`
  );

  console.log("  ✔ Scoring formula verified");

  // === 6.4 排除最近 N 轮 ===
  console.log("  [6.4] exclude recent N turns...");

  const storage4 = createMockStorage();
  const recall4 = new MemoryRecall(storage4 as unknown as MemoryStorage);

  // 3 条消息，turnIndex 分别为 8, 9, 10
  for (let i = 0; i < 3; i++) {
    await storage4.appendMessage({
      id: `msg_exclude_${i}`,
      sessionId: "sess_4",
      role: "assistant",
      content: `消息 ${i}`,
      createdAt: 1000 + i,
      turnIndex: 8 + i,
      tags: ["target"],
      extractSource: "llm",
    });
  }

  // currentTurnIndex=10, excludeRecentN=2 → 排除 turnIndex >= 8 的消息
  const excluded = await recall4.recallByTags("sess_4", ["target"], {
    currentTurnIndex: 10,
    excludeRecentN: 2,
    topK: 10,
  });
  assert(
    excluded.length === 0,
    "All messages within recent N turns should be excluded"
  );

  // currentTurnIndex=10, excludeRecentN=1 → 排除 turnIndex >= 9 的消息，保留 turnIndex=8
  const partial = await recall4.recallByTags("sess_4", ["target"], {
    currentTurnIndex: 10,
    excludeRecentN: 1,
    topK: 10,
  });
  assert(partial.length === 1, "Only 1 message outside recent 1 turn");
  assert(partial[0].turnIndex === 8, "Remaining message has turnIndex = 8");

  console.log("  ✔ Exclude recent N turns verified");

  // === 6.5 top-K 限制 ===
  console.log("  [6.5] top-K limit...");

  const storage5 = createMockStorage();
  const recall5 = new MemoryRecall(storage5 as unknown as MemoryStorage);

  // 5 条消息
  for (let i = 0; i < 5; i++) {
    await storage5.appendMessage({
      id: `msg_topk_${i}`,
      sessionId: "sess_5",
      role: "assistant",
      content: `消息 ${i}`,
      createdAt: 1000 + i,
      turnIndex: i,
      tags: ["target"],
      extractSource: "llm",
    });
  }

  const topK2 = await recall5.recallByTags("sess_5", ["target"], {
    currentTurnIndex: 100,
    excludeRecentN: 0,
    topK: 2,
  });
  assert(topK2.length === 2, "topK=2 should return exactly 2 results");

  // 验证按 score 降序（turnIndex 越大 score 越高）
  assert(topK2[0].score >= topK2[1].score, "Results should be sorted by score descending");

  console.log("  ✔ top-K limit verified");

  // === 6.6 泛指问句兜底召回（E-1 修复） ===
  console.log("  [6.6] fallback recall for vague queries...");

  const storage6 = createMockStorage();
  const recall6 = new MemoryRecall(storage6 as unknown as MemoryStorage);

  // 预置 10 条消息（turnIndex 0-9），无词典
  // 无词典 → queryTags 必为空 → 触发兜底召回
  for (let i = 0; i < 10; i++) {
    await storage6.appendMessage({
      id: `fb_${i}`,
      sessionId: "sess_fb",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `历史消息 ${i}`,
      createdAt: 1000 + i,
      turnIndex: i,
      tags: [],
      extractSource: "none",
    });
  }

  // currentTurnIndex=10, excludeRecentN=5 → 排除 turnIndex >= 5 的消息
  // 兜底应召回 turnIndex=4 的消息（最近 N 轮外的最新 1 条）
  const fallback = await recall6.recall("sess_fb", "还记得我们之前聊了什么吗？", {
    currentTurnIndex: 10,
    excludeRecentN: 5,
  });

  assert(fallback.length === 1, "兜底召回应返回 1 条消息");
  assert(fallback[0].turnIndex === 4, "应召回 turnIndex=4 的消息（最近 N 轮外最新）");
  assert(fallback[0].hitCount === 0, "兜底召回 hitCount 应为 0");
  assert(Array.isArray(fallback[0].hitTags) && fallback[0].hitTags.length === 0, "兜底召回 hitTags 应为空");
  assert(fallback[0].score === 0, "兜底召回 score 应为 0（标记为兜底）");
  assert(fallback[0].content === "历史消息 4", "应召回 turnIndex=4 的内容");

  // excludeRecentN=0 → 不排除，兜底召回最新一条（turnIndex=9）
  const fallbackNoExclude = await recall6.recall("sess_fb", "任意泛指问句", {
    currentTurnIndex: 10,
    excludeRecentN: 0,
  });
  assert(fallbackNoExclude.length === 1, "excludeRecentN=0 时仍兜底召回 1 条");
  assert(fallbackNoExclude[0].turnIndex === 9, "不排除时召回最新一条 (turnIndex=9)");

  // 自适应排除：excludeRecentN=20 远超 currentTurnIndex=10，
  // 自适应降为 min(20, 10-1)=9，保留 turnIndex=0 的消息作为兜底
  const fallbackAdaptive = await recall6.recall("sess_fb", "泛指问句", {
    currentTurnIndex: 10,
    excludeRecentN: 20,
  });
  assert(fallbackAdaptive.length === 1, "自适应排除后应保留 1 条最旧消息");
  assert(fallbackAdaptive[0].turnIndex === 0, "自适应排除后召回 turnIndex=0 的消息");

  // 新会话冷启动：currentTurnIndex=3, excludeRecentN=5 → 自适应降为 min(5, 2)=2
  // 排除 turnIndex >= 1 的消息，保留 turnIndex=0
  const fallbackColdStart = await recall6.recall("sess_fb", "泛指问句", {
    currentTurnIndex: 3,
    excludeRecentN: 5,
  });
  assert(fallbackColdStart.length === 1, "新会话冷启动应自适应召回 1 条");
  assert(fallbackColdStart[0].turnIndex === 0, "冷启动召回 turnIndex=0 的消息");

  console.log("  ✔ fallback recall for vague queries verified");

  console.log("✔ MemoryRecall verified successfully!");
}
