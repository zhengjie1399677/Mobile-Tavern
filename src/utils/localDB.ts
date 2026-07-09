import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
  CustomWorldbook,
} from "../types";
import { reportDbQueueTimeout } from "./telemetry";

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
  operation: () => Promise<T>;
  pendingPromise: Promise<T> | null;
}
const pendingKeyedWrites = new Map<string, CoalescedSlot<any>>();

// 单次 IDB 写事务的超时阈值（15 秒）。
// 正常 IDB 写操作通常在 100ms 内完成，15 秒足以覆盖极端慢速设备与大批量写入场景，
// 同时防止事务挂起导致写队列永久阻塞（P0-2 修复）。
const WRITE_OPERATION_TIMEOUT_MS = 15000;

function enqueueWrite<T>(operation: () => Promise<T>, key?: string): Promise<T> {
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

    // 事务级超时保护：防止单个 IDB 事务挂起导致整个写队列永久阻塞。
    // 超时后 reject，由 writeQueue 链的错误吞咽器（下方 then 的第二个回调）捕获，
    // 确保后续写操作不会被阻塞。
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`[localDB] Write operation timed out after ${WRITE_OPERATION_TIMEOUT_MS}ms`));
      }, WRITE_OPERATION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([latestOperation(), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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

export async function saveCharacter(character: CharacterCard): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.put(character);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `character:${character.id}`);  // P1-11: 同角色卡多次保存合并为一次落盘
}

export async function deleteCharacter(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
}

// === Sessions CRUD ===

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按主键单条直查会话。走主键索引毫秒级返回，避免 getAllSessions() 全量反序列化。
 */
export async function getSessionById(
  id: string
): Promise<ChatSession | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 仅获取会话总数（IDB count 不反序列化对象），用于分页计算。
 */
export async function getSessionsCount(): Promise<number> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.count();

    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 分页加载会话列表（按 createdAt 倒序）。
 * 使用 createdAt 索引跳过 offset，仅反序列化当前页条目。
 */
export async function getSessionsPaginated(
  page: number,
  pageSize: number
): Promise<ChatSession[]> {
  const db = await getDB();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 20);
  const offset = (safePage - 1) * safePageSize;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    // P0-1: 优先使用 createdAt 索引倒序遍历，确保分页结果按"最近会话优先"返回。
    // 若索引不存在（极端降级场景），回退到主键顺序。
    const index = store.indexNames.contains("createdAt")
      ? store.index("createdAt")
      : store;
    const results: ChatSession[] = [];
    let skipped = 0;
    let collected = 0;

    const request = index.openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        // 游标结束（无更多数据或本页为空）
        resolve(results);
        return;
      }
      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }
      if (collected < safePageSize) {
        results.push(cursor.value as ChatSession);
        collected++;
        cursor.continue();
        return;
      }
      // 已收集到当前页所需数量，提前 resolve（Promise 对重复 resolve 天然幂等）
      resolve(results);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

export async function saveSession(session: ChatSession): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      // 联合事务：同时写入 sessions 并同步 messages
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      
      // 1. 物理隔离：sessions 库中剔除 messages 大数组，同时计算并缓存字数与回合数，供前台懒加载分页与自动清理逻辑直接读取，避免视觉 Bug
      const sessionsStore = transaction.objectStore("sessions");
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
      
      const sessionRequest = sessionsStore.put(sessionToSave);
      
      // 2. 级联同步消息到 messages Store
      if (messages && Array.isArray(messages)) {
        const messagesStore = transaction.objectStore("messages");
        const msgIdsInSession = new Set(messages.map(m => m.id));
        
        // 2.1 清理在前端最新 messages 列表中不存在的旧数据库记录（同步分支回溯/单条消息删除）
        const sessionIdIndex = messagesStore.index("sessionId");
        const cursorRequest = sessionIdIndex.openCursor(IDBKeyRange.only(session.id));
        
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            const dbMsg = cursor.value;
            if (!msgIdsInSession.has(dbMsg.id)) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            // 2.2 更新或新增消息，继承数据库已存在的 tags 与 extractSource 字段避免覆盖竞态
            let processedCount = 0;
            if (messages.length === 0) {
              resolve();
              return;
            }
            
            messages.forEach((msg, idx) => {
              const getReq = messagesStore.get(msg.id);
              getReq.onsuccess = () => {
                const existingRecord = getReq.result;
                const record = {
                  id: msg.id,
                  sessionId: session.id,
                  role: msg.sender === "user" ? "user" as const : "assistant" as const,
                  content: msg.content,
                  createdAt: msg.timestamp || Date.now(),
                  // 保留已有 turnIndex（由 MemoryExtractor 写入），避免消息删除后 turnIndex 错乱；
                  // 仅对新消息使用数组下标作为初始值
                  turnIndex: existingRecord?.turnIndex ?? idx,
                  tags: existingRecord?.tags || (msg as any).tags || [],
                  extractSource: existingRecord?.extractSource || (msg as any).extractSource || "none",
                  metadata: (msg as any).metadata || msg.extra || existingRecord?.metadata,
                };
                
                const putRequest = messagesStore.put(record);
                putRequest.onsuccess = () => {
                  processedCount++;
                  if (processedCount === messages.length) {
                    resolve();
                  }
                };
                putRequest.onerror = () => reject(putRequest.error);
              };
              getReq.onerror = () => reject(getReq.error);
            });
          }
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      } else {
        sessionRequest.onsuccess = () => resolve();
        sessionRequest.onerror = () => reject(sessionRequest.error);
      }

      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `session:${session.id}`);  // P1-11: 同会话多次保存合并为一次落盘
}

export async function deleteSession(id: string): Promise<void> {
  // 会话删除时级联清理 messages 和 memory_dict Store 的相关数据，使用单事务保证原子性
  return enqueueWrite(async () => {
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
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `session:${id}:cascade`);  // 同会话级联删除合并为一次写入
}

// === Crypto Helpers for API Key Security ===

let cachedCryptoKey: CryptoKey | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

async function getOrCreateCryptoKey(db: IDBDatabase): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  if (cryptoKeyPromise) return cryptoKeyPromise;

  cryptoKeyPromise = new Promise<CryptoKey>((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.get("api_crypto_key");

    request.onsuccess = async () => {
      let key = request.result as CryptoKey | undefined;
      if (key) {
        cachedCryptoKey = key;
        resolve(key);
      } else {
        try {
          const newKey = await crypto.subtle.generateKey(
            {
              name: "AES-GCM",
              length: 256,
            },
            false, // Non-extractable for security
            ["encrypt", "decrypt"]
          );
          const putRequest = store.put(newKey, "api_crypto_key");
          putRequest.onsuccess = () => {
            cachedCryptoKey = newKey;
            resolve(newKey);
          };
          putRequest.onerror = () => {
            console.error("[localDB] Failed to save CryptoKey to IndexedDB settings:", putRequest.error);
            resolve(newKey);
          };
        } catch (err) {
          // DATA-03: 失败后重置 cryptoKeyPromise，允许后续重试，避免功能永久阻塞
          cryptoKeyPromise = null;
          reject(err);
        }
      }
    };

    request.onerror = () => {
      // DATA-03: 失败后重置 cryptoKeyPromise，允许后续重试
      cryptoKeyPromise = null;
      reject(request.error);
    };

    // DATA-01: 事务被中断时同样需要重置并 reject
    transaction.onabort = () => {
      cryptoKeyPromise = null;
      reject(transaction.error || new Error("Transaction aborted"));
    };
  });

  return cryptoKeyPromise;
}

const ENC_PREFIX = "enc_aes_gcm:";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptValue(plainText: string, key: CryptoKey): Promise<string> {
  if (!plainText) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  const ivBase64 = arrayBufferToBase64(iv.buffer);
  const cipherBase64 = arrayBufferToBase64(ciphertext);

  return `${ENC_PREFIX}${ivBase64}:${cipherBase64}`;
}

export async function decryptValue(encryptedText: string, key: CryptoKey): Promise<string> {
  if (!encryptedText) return "";
  if (!encryptedText.startsWith(ENC_PREFIX)) return encryptedText;

  try {
    const parts = encryptedText.substring(ENC_PREFIX.length).split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted format");
    }
    const iv = new Uint8Array(base64ToArrayBuffer(parts[0]));
    const ciphertext = base64ToArrayBuffer(parts[1]);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    console.error("[localDB] Decryption failed, falling back to empty string:", err);
    return "";
  }
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
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    
    // Perform shallow clone of root settings and shallow clone of API configurations
    // to prevent mutating the original settings objects in React memory state.
    const clonedSettings: UserSettings = {
      ...settings,
      api: settings.api ? { ...settings.api } : settings.api,
      savedApiProfiles: settings.savedApiProfiles
        ? settings.savedApiProfiles.map(profile => ({ ...profile }))
        : settings.savedApiProfiles,
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
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  }, "settings:user_settings");  // P1-11: 单一 settings 记录多次保存合并为一次落盘
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

export async function saveStoredSavedPresets(presets: any[]): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(presets, "saved_presets_bundle");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
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

export async function saveStoredDefaultCharactersInitializedFlag(initialized: boolean): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(initialized, "default_characters_initialized");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
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
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("lorebooks", "readwrite");
      const store = transaction.objectStore("lorebooks");
      const request = store.put(entries, "global_lorebook");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
}

export async function bulkSaveCharacters(charactersList: CharacterCard[]): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (charactersList.length === 0) return resolve();
      const transaction = db.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));

      for (const char of charactersList) {
        store.put(char);
      }
    });
  });
}

export async function bulkSaveSessions(sessionsList: ChatSession[]): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (sessionsList.length === 0) return resolve();
      const transaction = db.transaction(["sessions", "messages"], "readwrite");
      const sessionsStore = transaction.objectStore("sessions");
      const messagesStore = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));

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
            const record = {
              id: msg.id,
              sessionId: session.id,
              role: msg.sender === "user" ? "user" as const : "assistant" as const,
              content: msg.content,
              createdAt: msg.timestamp || Date.now(),
              turnIndex: (msg as any).turnIndex !== undefined ? (msg as any).turnIndex : idx,
              tags: (msg as any).tags || [],
              extractSource: (msg as any).extractSource || "none",
              metadata: (msg as any).metadata || msg.extra,
            };
            messagesStore.put(record);
          });
        }
      }
    });
  });
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
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("worldbooks", "readwrite");
      const store = transaction.objectStore("worldbooks");
      const request = store.put(worldbooks, "custom_worldbooks");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
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

export async function saveStoredUsageMetrics(metrics: any): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(metrics, "usage_metrics");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
}

// === Messages Store CRUD (v8 记忆系统物理分轨) ===
// 存储所有原始对话消息，按 sessionId 隔离，永久保留。
// 严禁将 messages 数组塞回 sessions 表，避免反序列化延时引发白屏（AGENTS.md 准则一）。

/**
 * 追加一条消息到 messages Store。
 * 使用 enqueueWrite 串行化写入，key 合并机制确保同 ID 多次写入只落盘最新版本。
 */
export async function appendMessage(message: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
  turnIndex: number;
  tags?: string[];
  extractSource?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const record = {
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        turnIndex: message.turnIndex,
        tags: message.tags || [],
        extractSource: message.extractSource || "none",
        metadata: message.metadata,
      };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `message:${message.id}`);
}

/**
 * 按主键单条直查消息。
 */
export async function getMessageById(id: string): Promise<any | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按会话查询所有消息（按 createdAt 升序）。
 * 优先使用复合索引 sessionId_createdAt（仅游标范围查询，高效），
 * 降级时使用 sessionId 单值索引并在内存中按 createdAt 排序。
 */
export async function getMessagesBySession(
  sessionId: string,
  options?: { limit?: number; offset?: number; descending?: boolean }
): Promise<any[]> {
  const db = await getDB();
  const limit = options?.limit;
  const offset = options?.offset || 0;
  const descending = !!options?.descending;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    // 复合索引 [sessionId, createdAt] 可用 → 用 bound 范围查询
    if (store.indexNames.contains("sessionId_createdAt")) {
      const index = store.index("sessionId_createdAt");
      const results: any[] = [];
      let skipped = 0;
      let collected = 0;

      const lower = [sessionId, -Infinity];
      const upper = [sessionId, Infinity];
      const direction: IDBCursorDirection = descending ? "prev" : "next";
      const request = index.openCursor(IDBKeyRange.bound(lower, upper), direction);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          // 按照 turnIndex 升序排序，若 turnIndex 相同或缺失则按 createdAt 排序
          results.sort((a, b) => {
            const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
            const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
            if (turnA !== turnB) return turnA - turnB;
            return a.createdAt - b.createdAt;
          });
          if (descending) {
            results.reverse();
          }
          resolve(results);
          return;
        }
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        if (limit !== undefined && collected >= limit) {
          // 同样进行排序和翻转
          results.sort((a, b) => {
            const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
            const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
            if (turnA !== turnB) return turnA - turnB;
            return a.createdAt - b.createdAt;
          });
          if (descending) {
            results.reverse();
          }
          resolve(results);
          return;
        }
        results.push(cursor.value);
        collected++;
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
      return;
    }

    // 降级：使用 sessionId 单值索引 + 内存排序
    if (store.indexNames.contains("sessionId")) {
      const index = store.index("sessionId");
      const request = index.getAll(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const all = request.result || [];
        all.sort((a, b) => {
          const turnA = a.turnIndex !== undefined ? a.turnIndex : 0;
          const turnB = b.turnIndex !== undefined ? b.turnIndex : 0;
          if (turnA !== turnB) return turnA - turnB;
          return a.createdAt - b.createdAt;
        });
        if (descending) {
          all.reverse();
        }
        const sliced =
          limit !== undefined
            ? all.slice(offset, offset + limit)
            : all.slice(offset);
        resolve(sliced);
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
      return;
    }

    // 极端降级：全表扫描
    const request = store.getAll();
    request.onsuccess = () => {
      const all = (request.result || [])
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => descending ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
      const sliced =
        limit !== undefined
          ? all.slice(offset, offset + limit)
          : all.slice(offset);
      resolve(sliced);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按标签查询消息（倒排召回）。
 * 使用 tags 多值索引，返回命中指定标签的消息列表。
 * @param sessionId 限定会话范围，避免跨会话污染
 * @param tags      查询标签数组（任一命中即返回）
 * @param limit     返回条数上限
 */
export async function getMessagesByTag(
  sessionId: string,
  tags: string[],
  limit?: number
): Promise<any[]> {
  if (!tags || tags.length === 0) return [];
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");

    if (!store.indexNames.contains("tags")) {
      // 索引不存在时降级为全表扫描过滤
      const fallbackReq = store.getAll();
      fallbackReq.onsuccess = () => {
        const all = fallbackReq.result || [];
        const tagSet = new Set(tags);
        const filtered = all
          .filter(
            (m) =>
              m.sessionId === sessionId &&
              Array.isArray(m.tags) &&
              m.tags.some((t) => tagSet.has(t))
          )
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(limit !== undefined ? filtered.slice(0, limit) : filtered);
      };
      fallbackReq.onerror = () => reject(fallbackReq.error);
      return;
    }

    const index = store.index("tags");
    const results: any[] = [];
    const seenIds = new Set<string>();
    let pending = tags.length;

    if (pending === 0) {
      resolve([]);
      return;
    }

    for (const tag of tags) {
      const req = index.getAll(IDBKeyRange.only(tag));
      req.onsuccess = () => {
        const hits = req.result || [];
        for (const msg of hits) {
          if (
            msg.sessionId === sessionId &&
            !seenIds.has(msg.id)
          ) {
            seenIds.add(msg.id);
            results.push(msg);
          }
        }
        pending--;
        if (pending === 0) {
          // 按时间倒序
          results.sort((a, b) => b.createdAt - a.createdAt);
          resolve(limit !== undefined ? results.slice(0, limit) : results);
        }
      };
      req.onerror = () => reject(req.error);
    }
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 删除指定会话的所有消息（用于会话删除时级联清理）。
 */
export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const index = store.index("sessionId");
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  });
}

// === Memory Dict Store CRUD (v8 记忆系统会话级自动学习词典) ===

/**
 * 更新或插入词典条目。
 * 使用复合键 `${sessionId}:${entity}` 保证会话内实体唯一。
 */
/**
 * 更新或插入词典条目（原子操作）。
 * 使用复合键 `${sessionId}:${entity}` 保证会话内实体唯一。
 * 将“读取旧数据 -> 判断新建或更新 -> 写入新数据”包裹在单个 enqueueWrite 中串行化执行，
 * 彻底消除高并发下的 Read-After-Write 脏读与 Count 计数丢失问题。
 *
 * 保持单对象参数签名以兼容现有 UI 调用处。
 *
 * @returns Promise<boolean> 标识是否为新建实体（true 表示新建，false 表示更新）
 */
export async function upsertDictEntry(entry: {
  id?: string;
  sessionId: string;
  entity: string;
  aliases?: string[];
  type?: string;
  firstSeenMsgId: string;
  firstSeenTurn: number;
  count?: number;
  createdAt?: number;
  updatedAt?: number;
}): Promise<boolean> {
  const id = entry.id || `${entry.sessionId}:${entry.entity}`;
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction("memory_dict", "readwrite");
      const store = transaction.objectStore("memory_dict");
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        let isNew = false;
        let record: any;

        if (existing) {
          const nextCount = entry.count !== undefined ? entry.count : (existing.count || 0) + 1;
          record = {
            id,
            sessionId: entry.sessionId,
            entity: entry.entity,
            aliases: entry.aliases ?? existing.aliases ?? [],
            type: entry.type ?? existing.type ?? "concept",
            firstSeenMsgId: existing.firstSeenMsgId,
            firstSeenTurn: existing.firstSeenTurn,
            count: nextCount,
            createdAt: existing.createdAt,
            updatedAt: entry.updatedAt ?? now,
          };
        } else {
          isNew = true;
          record = {
            id,
            sessionId: entry.sessionId,
            entity: entry.entity,
            aliases: entry.aliases ?? [],
            type: entry.type ?? "concept",
            firstSeenMsgId: entry.firstSeenMsgId,
            firstSeenTurn: entry.firstSeenTurn,
            count: entry.count ?? 1,
            createdAt: entry.createdAt ?? now,
            updatedAt: entry.updatedAt ?? now,
          };
        }

        const putRequest = store.put(record);
        putRequest.onsuccess = () => resolve(isNew);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getReq.onerror = () => reject(getReq.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `dict:${id}`);
}

/**
 * 按主键单条直查词典条目。
 */
export async function getDictEntryById(id: string): Promise<any | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_dict", "readonly");
    const store = transaction.objectStore("memory_dict");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 按会话查询所有词典条目。
 */
export async function getDictBySession(sessionId: string): Promise<any[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_dict", "readonly");
    const store = transaction.objectStore("memory_dict");
    const index = store.index("sessionId");
    const request = index.getAll(IDBKeyRange.only(sessionId));

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("Transaction aborted"));
  });
}

/**
 * 删除指定会话的所有词典条目（用于会话删除时级联清理）。
 */
export async function deleteDictBySession(sessionId: string): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_dict", "readwrite");
      const store = transaction.objectStore("memory_dict");
      const index = store.index("sessionId");
      const request = index.openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  });
}

/**
 * 原子化地向指定会话追加一条时间轴总结卡片（SummaryCard）。
 * 该操作完全在 enqueueWrite 队列中串行执行，确保在高频对话并发写入时不会发生“写覆盖”导致的消息丢失。
 *
 * @returns Promise<ChatSession> 返回更新后的会话（不含 messages，供写入后由上层重新装配）
 */
export async function appendSessionSummary(
  sessionId: string,
  newCard: any
): Promise<ChatSession> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<ChatSession>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const getReq = store.get(sessionId);

      getReq.onsuccess = () => {
        const existingSession = getReq.result;
        if (!existingSession) {
          reject(new Error(`[localDB] Session ${sessionId} not found for appending summary.`));
          return;
        }

        const updatedSession = {
          ...existingSession,
          summaries: [...(existingSession.summaries || []), newCard],
          lastSummarizedMessageId: newCard.lastMessageId,
        };

        const putReq = store.put(updatedSession);
        putReq.onsuccess = () => resolve(updatedSession);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `session:${sessionId}`);
}

