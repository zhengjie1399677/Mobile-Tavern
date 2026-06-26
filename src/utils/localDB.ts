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
const DB_VERSION = 7;

let dbInstance: IDBDatabase | null = null;

// Global Promise-based queue to serialize all IndexedDB write operations sequentially.
// This prevents concurrent write transactions from conflicting or deadlocking, which is critical in WebView environments.
let writeQueue: Promise<any> = Promise.resolve();
let activeWriteQueueCount = 0;

// P1-11: 写队列深度上限安全网。
// 正常情况下由于 key 合并机制，队列深度不会无限增长；此阈值作为最后防线，
// 一旦触发即上报遥测告警，便于诊断异常堆积场景（如循环 bug 触发海量写入）。
const MAX_WRITE_QUEUE_DEPTH = 100;

// P1-11: 按 key 合并的待执行写槽位。
// 当多个写操作针对同一 key（如同一 session.id 的多次 saveSession）排队时，
// 仅保留最新 operation，共享同一 Promise，从而将每 key 队列深度收敛为 1。
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
  // P1-11: key 合并 —— 若同一 key 的写操作已在队列中等待，则用最新 operation 替换旧的，
  // 并返回共享 Promise。这样同一 session/character 的多次保存只会实际落盘一次（最新数据）。
  if (key) {
    const existing = pendingKeyedWrites.get(key);
    if (existing) {
      existing.operation = operation;
      return existing.pendingPromise as Promise<T>;
    }
  }

  const enqueueTime = Date.now();
  activeWriteQueueCount++;

  // P1-11: 深度上限安全网 —— 超过阈值时上报遥测，但仍然入队（保证数据完整性，不丢弃）。
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

  // P1-11: 用可变 slot 包裹 operation，使得后续同 key 写入能替换 operation。
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

    // P1-11: 执行前从 pendingKeyedWrites 移除本 key，使执行期间的新的同 key 写入可入队。
    // 读取 slot 中最新的 operation（可能已被合并替换为更新版本）。
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
  // Chain the next task, catching any errors to ensure subsequent queue operations still run.
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

      // v7 升级 (P0-1): 创建 sessions.createdAt 索引，支持按时间倒序分页加载，
      // 避免启动时 getAll() 全量反序列化阻塞首屏。
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
 * P0-4 / P1-4 基础设施：按主键单条直查角色卡。
 * 使用 store.get(id) 走主键索引，毫秒级返回，避免 getAll() 全量反序列化。
 * 用于角色详情页、聊天页加载等"仅需一个角色"的场景。
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
 * P0-2 基础设施：按主键单条直查会话。
 * 使用 store.get(id) 走主键索引，毫秒级返回，避免 getAllSessions() 全量反序列化。
 * 用于 AutoSummaryService 等仅需查找当前会话最新版本的场景。
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
 * PERF-03: 仅获取会话总数（IDB count 不反序列化对象）。
 * 用于分页计算总页数，避免 getAll() 一次性反序列化整个 sessions 表。
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
 * PERF-03 / P0-1: 分页加载会话列表（按 createdAt 倒序）。
 * 使用 createdAt 索引的 openCursor(prev) 跳过前 (page-1)*pageSize 条，
 * 仅反序列化当前页所需条目，显著减少初始加载时间与内存占用。
 *
 * @param page     页码，从 1 开始（小于 1 自动校正为 1）
 * @param pageSize 每页条数（小于 1 自动校正为 20）
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
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.put(session);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  }, `session:${session.id}`);  // P1-11: 同会话多次保存合并为一次落盘
}

export async function deleteSession(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    });
  });
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
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));

      for (const session of sessionsList) {
        store.put(session);
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

