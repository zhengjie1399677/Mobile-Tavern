import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
  CustomWorldbook,
  Message,
} from "../types";
import { reportDbQueueTimeout } from "./telemetry";
import {
  decryptValue,
  encryptValue,
  getOrCreateCryptoKey,
} from "../infrastructure/storage/settingsCrypto";
import { toSessionStorageRecord } from "../infrastructure/storage/sessionRecord";

// 保持既有公共导入路径兼容；物理实现已拆至基础设施模块。
export { decryptValue, encryptValue } from "../infrastructure/storage/settingsCrypto";

// 内存 Message 在持久化到 messages Store 时可能携带的额外字段。
// 这些字段由记忆系统写入，但未纳入 Message 接口契约，故在此显式声明以避免类型逃逸。
type PersistedMessage = Message & {
  turnIndex?: number;
  tags?: string[];
  extractSource?: string;
  metadata?: Record<string, unknown>;
};

const DB_NAME = "MobileTavernLiteDB";
// v7: 新增 sessions.createdAt 索引，支持按时间倒序分页加载（P0-1）
// v8: 新增 messages 和 memory_dict Store，承载记忆系统物理分轨存储（AGENTS.md 准则一）
const DB_VERSION = 8;

let dbInstance: IDBDatabase | null = null;

/**
 * 测试专用：重置模块级 DB 实例缓存与写队列。
 * 仅供 tests/ 下的测试套件在 mock IDB 前调用，严禁在生产代码中使用。
 */
export function __resetDBInstanceForTesting(): void {
  dbInstance = null;
  writeQueue = Promise.resolve();
  activeWriteQueueCount = 0;
  pendingKeyedWrites.clear();
}

// 全局基于 Promise 的队列，顺序串行化所有 IndexedDB 写入操作。
// 防止并发写入事务冲突或死锁，这在 WebView 原生环境中至关重要。
let writeQueue: Promise<any> = Promise.resolve();
let activeWriteQueueCount = 0;

// 写队列深度上限安全网：正常情况下由于 key 合并机制队列不会无限增长；阈值上报遥测告警用于诊断异常堆积。
const MAX_WRITE_QUEUE_DEPTH = 100;

// 按 key 合并待执行写槽位：当多个写操作针对同一 key 排队时，仅保留最新 operation 并共享同一 Promise。
interface CoalescedSlot<T> {
  operation: (ctx: WriteContext) => Promise<T>;
  pendingPromise: Promise<T> | null;
}
const pendingKeyedWrites = new Map<string, CoalescedSlot<any>>();

// 单次 IDB 写事务的超时阈值（15 秒）。
// 正常 IDB 写操作通常在 100ms 内完成，15 秒足以覆盖极端慢速设备与大批量写入场景，
// 同时防止事务挂起导致写队列永久阻塞（P0-2 修复）。
const WRITE_OPERATION_TIMEOUT_MS = 15000;

/**
 * 写操作取消上下文（AbortSignal 协作式中断传导）。
 *
 * 设计目的：解决 AbortSignal 仅作协作式中断、未透传至底层 IDB 事务的缺陷。
 * 当外部 signal 触发 abort 或写队列超时时，由 enqueueWrite 调用 registerAbort
 * 注册的句柄主动执行 transaction.abort()，真正释放底层 IDB 资源，避免事务挂起与死锁。
 *
 * 职责边界：
 *   - signal：外部取消信号（通常来自服务级 AbortController，如 DatabaseService.destroy）
 *   - registerAbort：operation 在创建 IDB 事务后注册 abort 句柄，供超时/取消时回调
 *   - aborted：是否已主动取消（超时或 signal abort）；为 true 时 onabort 不重复 reject
 */
export interface WriteContext {
  readonly signal?: AbortSignal;
  registerAbort(fn: () => void): void;
  readonly aborted: boolean;
}

/** 构造标准的 AbortError，兼容缺失 DOMException 的环境 */
function createAbortError(message = "The operation was aborted"): DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  // 兜底：极少数无 DOMException 的环境退化为普通 Error
  const err = new Error(message);
  (err as { name?: string }).name = "AbortError";
  return err as unknown as DOMException;
}

/**
 * 绑定 IDB 事务的主动 abort 句柄与非主动 abort 的 reject 行为。
 *
 * - 注册 abort 句柄到 ctx：当超时或外部 signal abort 时，由 enqueueWrite 回调
 *   `transaction.abort()` 真正释放底层 IDB 资源（核心修复：避免事务挂起死锁）。
 * - 设置 onabort：仅当非主动 abort（如 QuotaExceededError）时 reject；
 *   主动 abort（ctx.aborted）时由 race 的 timeout/signal 分支决定最终错误，
 *   避免重复 reject 与错误信息覆盖。
 *
 * 调用方在创建事务后立即调用本函数，替代原本手写的 `transaction.onabort = ...`。
 */
export function bindTransactionAbort(
  ctx: WriteContext,
  transaction: IDBTransaction,
  reject: (e: unknown) => void
): void {
  ctx.registerAbort(() => {
    try { transaction.abort(); } catch { /* 事务可能已自行结束，忽略二次 abort */ }
  });
  transaction.onabort = () => {
    if (ctx.aborted) return; // 主动 abort：由 race 的 timeout/signal 分支决定最终错误
    reject(transaction.error || new Error("Transaction aborted"));
  };
}

export function enqueueWrite<T>(
  operation: (ctx: WriteContext) => Promise<T>,
  key?: string,
  externalSignal?: AbortSignal
): Promise<T> {
  // key 合并：若同一 key 的写操作已在队列中等待，用最新 operation 替换旧的并返回共享 Promise
  if (key) {
    const existing = pendingKeyedWrites.get(key);
    if (existing) {
      existing.operation = operation;
      return existing.pendingPromise as Promise<T>;
    }
  }

  const enqueueTime = Date.now();
  activeWriteQueueCount++;

  // 深度上限安全网 —— 超过阈值时上报遥测，但仍然入队保证数据完整性
  if (activeWriteQueueCount >= MAX_WRITE_QUEUE_DEPTH) {
    console.error(
      `[localDB] Write queue depth ${activeWriteQueueCount} exceeded safety threshold ${MAX_WRITE_QUEUE_DEPTH}. This indicates abnormal write accumulation.`
    );
    setTimeout(() => {
      try {
        reportDbQueueTimeout(0, activeWriteQueueCount);
      } catch (e) {
        console.error("Failed to report queue overflow telemetry:", e);
      }
    }, 0);
  }

  // 用可变 slot 包裹 operation，使得后续同 key 写入能替换 operation
  const slot: CoalescedSlot<T> = { operation, pendingPromise: null };
  if (key) {
    pendingKeyedWrites.set(key, slot);
  }

  const queuedOperation = async () => {
    activeWriteQueueCount--;
    const queueDelay = Date.now() - enqueueTime;
    if (queueDelay > 3000) {
      console.warn(`[localDB] Write queue delay exceeded threshold: ${queueDelay}ms. Reporting warning.`);
      setTimeout(() => {
        try {
          reportDbQueueTimeout(queueDelay, activeWriteQueueCount + 1);
        } catch (e) {
          console.error("Failed to report queue timeout telemetry:", e);
        }
      }, 0);
    }

    // 执行前从 pendingKeyedWrites 移除本 key，使执行期间新的同 key 写入可入队
    if (key) pendingKeyedWrites.delete(key);
    const latestOperation = slot.operation;

    // ── AbortSignal 协作式中断传导（TODO #5）──────────────────────────
    // 1) 进入执行前 signal 已 abort：立即拒绝，避免无谓创建 IDB 事务
    if (externalSignal?.aborted) {
      throw createAbortError();
    }

    let abortFn: (() => void) | null = null;
    let abortedState = false;
    const ctx: WriteContext = {
      signal: externalSignal,
      get aborted() { return abortedState; },
      registerAbort(fn) { abortFn = fn; },
    };

    // signal abort 监听：触发时主动 abort 底层事务并 reject
    let signalReject!: (e: unknown) => void;
    const signalAbortPromise = new Promise<never>((_, reject) => {
      signalReject = reject;
    });
    const onAbort = () => {
      abortedState = true;
      if (abortFn) {
        try { abortFn(); } catch { /* 事务可能已自行结束，忽略 */ }
      }
      signalReject(createAbortError());
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onAbort);
    }

    // 事务级超时保护：防止单个 IDB 事务挂起导致整个写队列永久阻塞。
    // 超时后主动调用 transaction.abort() 释放底层资源（核心修复），再 reject。
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortedState = true;
        if (abortFn) {
          try { abortFn(); } catch { /* 事务可能已自行结束，忽略 */ }
        }
        reject(new Error(`[localDB] Write operation timed out after ${WRITE_OPERATION_TIMEOUT_MS}ms`));
      }, WRITE_OPERATION_TIMEOUT_MS);
    });

    try {
      // 三路 race：operation 成功 / 超时 / signal abort
      // 主动 abort 时 operation 的 onabort 不重复 reject（由 ctx.aborted 短路）
      return await Promise.race([latestOperation(ctx), timeoutPromise, signalAbortPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    }
  };

  const result = writeQueue.then(queuedOperation);
  // 链接下一个任务，捕获所有异常确保后续队列操作正常运行
  writeQueue = result.then(
    () => {},
    () => {}
  );
  slot.pendingPromise = result;
  return result;
}

export function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      
      resolve(request.result);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      let charStore: IDBObjectStore;
      if (!db.objectStoreNames.contains("characters")) {
        charStore = db.createObjectStore("characters", { keyPath: "id" });
      } else {
        charStore = request.transaction!.objectStore("characters");
      }

      let sessionStore: IDBObjectStore;
      if (!db.objectStoreNames.contains("sessions")) {
        sessionStore = db.createObjectStore("sessions", { keyPath: "id" });
      } else {
        sessionStore = request.transaction!.objectStore("sessions");
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }

      // v2 升级: 为 sessions 仓库创建 characterId 检索索引，加速获取指定角色下的聊天历史列表
      if (!sessionStore.indexNames.contains("characterId")) {
        sessionStore.createIndex("characterId", "characterId", { unique: false });
      }

      // 创建 sessions.createdAt 索引，支持按时间倒序分页加载，避免启动全量反序列化
      // 向前兼容：ChatSession.createdAt 是必需字段，所有现存记录均含此值。
      if (!sessionStore.indexNames.contains("createdAt")) {
        sessionStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // v6 升级: 创建专门的 lorebooks 和 worldbooks store，隔离大对象以防 settings 膨胀导致白屏
      let lorebooksStore: IDBObjectStore;
      if (!db.objectStoreNames.contains("lorebooks")) {
        lorebooksStore = db.createObjectStore("lorebooks");
      } else {
        lorebooksStore = request.transaction!.objectStore("lorebooks");
      }

      let worldbooksStore: IDBObjectStore;
      if (!db.objectStoreNames.contains("worldbooks")) {
        worldbooksStore = db.createObjectStore("worldbooks");
      } else {
        worldbooksStore = request.transaction!.objectStore("worldbooks");
      }

      if (oldVersion < 6) {
        const settingsStore = request.transaction!.objectStore("settings");

        // 自动迁移 global_lorebook 到 lorebooks
        const reqLore = settingsStore.get("global_lorebook");
        reqLore.onsuccess = () => {
          if (reqLore.result) {
            lorebooksStore.put(reqLore.result, "global_lorebook");
            settingsStore.delete("global_lorebook");
          }
        };

        // 自动迁移 custom_worldbooks 到 worldbooks
        const reqWorld = settingsStore.get("custom_worldbooks");
        reqWorld.onsuccess = () => {
          if (reqWorld.result) {
            worldbooksStore.put(reqWorld.result, "custom_worldbooks");
            settingsStore.delete("custom_worldbooks");
          }
        };
      }

      // v8 升级 (记忆系统): 创建 messages 和 memory_dict Store
      // 物理分轨存储原始对话消息与会话级自动学习词典，避免污染 sessions 表
      // 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第四章
      if (!db.objectStoreNames.contains("messages")) {
        const messagesStore = db.createObjectStore("messages", { keyPath: "id" });
        // 按会话查询消息
        messagesStore.createIndex("sessionId", "sessionId", { unique: false });
        // 按时间排序
        messagesStore.createIndex("createdAt", "createdAt", { unique: false });
        // 多值索引：按标签倒排召回
        messagesStore.createIndex("tags", "tags", { unique: false, multiEntry: true });
        // 复合索引：按会话+时间分页查询
        messagesStore.createIndex("sessionId_createdAt", ["sessionId", "createdAt"], { unique: false });
      }

      if (!db.objectStoreNames.contains("memory_dict")) {
        const dictStore = db.createObjectStore("memory_dict", { keyPath: "id" });
        // 按会话查询词典
        dictStore.createIndex("sessionId", "sessionId", { unique: false });
        // 按实体名查询（跨会话去重场景）
        dictStore.createIndex("entity", "entity", { unique: false });
      }
    };
  });
}

// === Characters CRUD ===

export async function getAllCharacters(): Promise<CharacterCard[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readonly");
    const store = transaction.objectStore("characters");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按主键单条直查角色卡。走主键索引毫秒级返回，避免 getAll() 全量反序列化。
 */
export async function getCharacterById(
  id: string
): Promise<CharacterCard | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readonly");
    const store = transaction.objectStore("characters");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function saveCharacter(character: CharacterCard, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.put(character);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `character:${character.id}`, signal);  // P1-11: 同角色卡多次保存合并为一次落盘
}

export async function deleteCharacter(id: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

// 会话查询物理实现已拆分；保留旧导入路径以兼容现有调用方。
export {
  getAllSessions,
  getSessionById,
  getSessionsCount,
  getSessionsPaginated,
} from "../infrastructure/storage/indexedDbSessionQueries";

/**
 * 保存会话元数据到 sessions Store。
 *
 * **职责边界（2026-07-11 重构）**：
 *   - 只写入 sessions Store（会话元数据），不触碰 messages Store。
 *   - 从 messages 计算 turnCount / charCount 缓存字段，供前台懒加载分页使用。
 *   - 不再做消息全量同步（旧实现的 N 次 GET+PUT 已废弃，消除"多存"问题）。
 *   - 不再做孤儿清理（旧实现的 cursor.delete 已废弃，消除"遗漏"风险）。
 *
 * 新消息的持久化由调用方通过 appendSessionMessage / appendMessage 单条写入。
 * 消息删除由调用方通过 deleteMessageById 显式删除。
 * 批量同步（备份恢复/分支创建）使用 syncSessionMessages。
 */
export async function saveSession(session: ChatSession, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const sessionsStore = transaction.objectStore("sessions");

      const sessionToSave = toSessionStorageRecord(session);

      const request = sessionsStore.put(sessionToSave);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${session.id}`, signal);  // P1-11: 同会话多次保存合并为一次落盘
}

export async function deleteSession(id: string, signal?: AbortSignal): Promise<void> {
  // 会话删除时级联清理 messages 和 memory_dict Store 的相关数据，使用单事务保证原子性
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      // 跨 Store 事务：sessions + messages + memory_dict
      const transaction = db.transaction(
        ["sessions", "messages", "memory_dict"],
        "readwrite"
      );
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");
      const dictStore = transaction.objectStore("memory_dict");

      // 1. 删除会话主记录
      sessionsStore.delete(id);

      // 2. 删除 messages Store 中该 sessionId 的所有消息（含 tags 索引项）
      const messagesIndex = messagesStore.index("sessionId");
      const msgCursorReq = messagesIndex.openCursor(IDBKeyRange.only(id));
      msgCursorReq.onsuccess = () => {
        const cursor = msgCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      msgCursorReq.onerror = () => reject(msgCursorReq.error);

      // 3. 删除 memory_dict Store 中该 sessionId 的所有词典条目
      const dictIndex = dictStore.index("sessionId");
      const dictCursorReq = dictIndex.openCursor(IDBKeyRange.only(id));
      dictCursorReq.onsuccess = () => {
        const cursor = dictCursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      dictCursorReq.onerror = () => reject(dictCursorReq.error);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `session:${id}:cascade`, signal);  // 同会话级联删除合并为一次写入
}

// === Settings Helper ===

export async function getStoredSettings(): Promise<UserSettings | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("user_settings");

    request.onsuccess = async () => {
      const settings = request.result as UserSettings | null;
      if (!settings) {
        resolve(null);
        return;
      }

      // v6 升级/优化: 并行获取大文本配置并重新拼装以保障向前兼容与零数据丢失
      const reqLarge = store.get("user_settings_large_prompts");
      reqLarge.onerror = () => reject(reqLarge.error);
      reqLarge.onsuccess = async () => {
        const large = reqLarge.result || {};

        if (settings.promptConfig) {
          if (large.mainPrompt !== undefined) settings.promptConfig.mainPrompt = large.mainPrompt;
          if (large.jailbreakPrompt !== undefined) settings.promptConfig.jailbreakPrompt = large.jailbreakPrompt;
          if (large.postHistoryPrompt !== undefined) settings.promptConfig.postHistoryPrompt = large.postHistoryPrompt;
          if (large.reasoningGuidancePrompt !== undefined) settings.promptConfig.reasoningGuidancePrompt = large.reasoningGuidancePrompt;
          if (large.tableMemoryPrompt !== undefined) settings.promptConfig.tableMemoryPrompt = large.tableMemoryPrompt;
          if (large.promptComposition !== undefined) settings.promptConfig.composition = large.promptComposition;
        } else {
          settings.promptConfig = {
            mainPrompt: large.mainPrompt || "",
            jailbreakPrompt: large.jailbreakPrompt || "",
            postHistoryPrompt: large.postHistoryPrompt || "",
            reasoningGuidancePrompt: large.reasoningGuidancePrompt || "",
            tableMemoryPrompt: large.tableMemoryPrompt || "",
            roleplayMode: true,
            useJailbreak: true,
            usePostHistory: true,
            instructTemplate: "default",
            systemPrefix: "",
            systemSuffix: "",
            userPrefix: "",
            userSuffix: "",
            assistantPrefix: "",
            assistantSuffix: "",
          };
        }

        if (large.bisonModePrompt !== undefined) settings.bisonModePrompt = large.bisonModePrompt;
        if (large.replySuggestionsPrompt !== undefined) settings.replySuggestionsPrompt = large.replySuggestionsPrompt;

        try {
          const key = await getOrCreateCryptoKey(db);
          if (settings.api && settings.api.apiKey) {
            settings.api.apiKey = await decryptValue(settings.api.apiKey, key);
          }
          if (settings.savedApiProfiles && Array.isArray(settings.savedApiProfiles)) {
            for (const profile of settings.savedApiProfiles) {
              if (profile.apiKey) {
                profile.apiKey = await decryptValue(profile.apiKey, key);
              }
            }
          }
        } catch (err) {
          console.error("[localDB] Failed to decrypt settings API keys:", err);
        }

        resolve(settings);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredSettings(
  settings: UserSettings,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    
    // Perform shallow clone of root settings and shallow clone of API configurations
    // to prevent mutating the original settings objects in React memory state.
    const clonedSettings: UserSettings = {
      ...settings,
      api: settings.api ? { ...settings.api } : settings.api,
      savedApiProfiles: settings.savedApiProfiles
        ? settings.savedApiProfiles.map(profile => ({ ...profile }))
        : settings.savedApiProfiles,
      customThemes: settings.customThemes
        ? settings.customThemes.map(theme => ({
            ...theme,
            variables: { ...theme.variables },
          }))
        : settings.customThemes,
    };

    // DATA-04: 加密过程错误处理。失败时清空对应 apiKey 字段以防止明文落库，
    // 同时保留其他字段正常写入；密钥获取失败时清空全部 apiKey 字段。
    let cryptoKey: CryptoKey | null = null;
    try {
      cryptoKey = await getOrCreateCryptoKey(db);
    } catch (err) {
      console.error("[localDB] Failed to obtain crypto key, clearing apiKey fields to prevent plaintext storage:", err);
    }

    if (cryptoKey) {
      if (clonedSettings.api && clonedSettings.api.apiKey) {
        try {
          clonedSettings.api.apiKey = await encryptValue(clonedSettings.api.apiKey, cryptoKey);
        } catch (err) {
          // 跳过当前 apiKey 字段的加密，清空以避免明文落库
          console.error("[localDB] Failed to encrypt api.apiKey, clearing to prevent plaintext storage:", err);
          clonedSettings.api.apiKey = "";
        }
      }
      if (clonedSettings.savedApiProfiles && Array.isArray(clonedSettings.savedApiProfiles)) {
        for (const profile of clonedSettings.savedApiProfiles) {
          if (profile.apiKey) {
            try {
              profile.apiKey = await encryptValue(profile.apiKey, cryptoKey);
            } catch (err) {
              console.error("[localDB] Failed to encrypt profile.apiKey, clearing to prevent plaintext storage:", err);
              profile.apiKey = "";
            }
          }
        }
      }
    } else {
      // 无可用密钥：清空所有 apiKey 字段以杜绝明文落库
      if (clonedSettings.api) clonedSettings.api.apiKey = "";
      if (clonedSettings.savedApiProfiles && Array.isArray(clonedSettings.savedApiProfiles)) {
        for (const profile of clonedSettings.savedApiProfiles) {
          if (profile.apiKey) profile.apiKey = "";
        }
      }
    }

    // 分轨存储提取：将长文本大字段提取到独立的 IDB 键下
    const largePrompts = {
      mainPrompt: clonedSettings.promptConfig?.mainPrompt || "",
      jailbreakPrompt: clonedSettings.promptConfig?.jailbreakPrompt || "",
      postHistoryPrompt: clonedSettings.promptConfig?.postHistoryPrompt || "",
      reasoningGuidancePrompt: clonedSettings.promptConfig?.reasoningGuidancePrompt || "",
      tableMemoryPrompt: clonedSettings.promptConfig?.tableMemoryPrompt || "",
      promptComposition: clonedSettings.promptConfig?.composition,
      bisonModePrompt: clonedSettings.bisonModePrompt || "",
      replySuggestionsPrompt: clonedSettings.replySuggestionsPrompt || "",
    };

    if (clonedSettings.promptConfig) {
      clonedSettings.promptConfig = {
        ...clonedSettings.promptConfig,
        mainPrompt: "",
        jailbreakPrompt: "",
        postHistoryPrompt: "",
        reasoningGuidancePrompt: "",
        tableMemoryPrompt: "",
        composition: undefined,
      };
    }
    clonedSettings.bisonModePrompt = "";
    clonedSettings.replySuggestionsPrompt = "";

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      
      const reqLarge = store.put(largePrompts, "user_settings_large_prompts");
      reqLarge.onerror = () => reject(reqLarge.error);
      reqLarge.onsuccess = () => {
        const request = store.put(clonedSettings, "user_settings");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      };
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, "settings:user_settings", signal);  // P1-11: 单一 settings 记录多次保存合并为一次落盘
}

export async function getStoredSavedPresets(): Promise<any[] | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("saved_presets_bundle");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredSavedPresets(presets: any[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(presets, "saved_presets_bundle");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}


export async function getStoredDefaultCharactersInitializedFlag(): Promise<boolean> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("default_characters_initialized");

    request.onsuccess = () => resolve(!!request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredDefaultCharactersInitializedFlag(initialized: boolean, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(initialized, "default_characters_initialized");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}


export async function getGlobalLorebook(): Promise<LorebookEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("lorebooks", "readonly");
    const store = transaction.objectStore("lorebooks");
    const request = store.get("global_lorebook");

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGlobalLorebook(
  entries: LorebookEntry[],
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("lorebooks", "readwrite");
      const store = transaction.objectStore("lorebooks");
      const request = store.put(entries, "global_lorebook");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

export async function bulkSaveCharacters(charactersList: CharacterCard[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (charactersList.length === 0) return resolve();
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      for (const char of charactersList) {
        store.put(char);
      }
    });
  }, undefined, signal);
}

export async function bulkSaveSessions(sessionsList: ChatSession[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (sessionsList.length === 0) return resolve();
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      for (const session of sessionsList) {
        const { messages, ...sessionToSave } = session;
        if (messages && Array.isArray(messages)) {
          const userMsgCount = messages.filter(m => m.sender === "user").length;
          const computedTurnCount = userMsgCount > 0 
            ? userMsgCount 
            : (messages.length > 1 ? Math.floor(messages.length / 2) : (messages.length > 0 ? 1 : 0));
          const computedCharCount = messages.reduce((total, msg) => total + (msg.content?.length || 0), 0);
          
          sessionToSave.turnCount = computedTurnCount;
          sessionToSave.charCount = computedCharCount;
        }

        sessionsStore.put(sessionToSave);

        if (messages && Array.isArray(messages)) {
          messages.forEach((msg, idx) => {
            const persisted = msg as PersistedMessage;
            const record = {
              id: msg.id,
              sessionId: session.id,
              role: msg.sender === "user" ? "user" as const : "assistant" as const,
              content: msg.content,
              createdAt: msg.timestamp || Date.now(),
              turnIndex: persisted.turnIndex !== undefined ? persisted.turnIndex : idx,
              tags: persisted.tags || [],
              extractSource: persisted.extractSource || "none",
              metadata: persisted.metadata || msg.extra,
            };
            messagesStore.put(record);
          });
        }
      }
    });
  }, undefined, signal);
}

export async function getCustomWorldbooks(): Promise<Record<string, CustomWorldbook>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("worldbooks", "readonly");
    const store = transaction.objectStore("worldbooks");
    const request = store.get("custom_worldbooks");

    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
  });
}

export async function saveCustomWorldbooks(
  worldbooks: Record<string, CustomWorldbook>,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("worldbooks", "readwrite");
      const store = transaction.objectStore("worldbooks");
      const request = store.put(worldbooks, "custom_worldbooks");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

export async function getStoredUsageMetrics(): Promise<any | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("usage_metrics");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredUsageMetrics(metrics: any, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(metrics, "usage_metrics");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

