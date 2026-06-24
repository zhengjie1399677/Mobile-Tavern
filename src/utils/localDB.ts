import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
  CustomWorldbook,
} from "../types";
import { reportDbQueueTimeout } from "./telemetry";

const DB_NAME = "MobileTavernLiteDB";
const DB_VERSION = 6;

let dbInstance: IDBDatabase | null = null;

// Global Promise-based queue to serialize all IndexedDB write operations sequentially.
// This prevents concurrent write transactions from conflicting or deadlocking, which is critical in WebView environments.
let writeQueue: Promise<any> = Promise.resolve();
let activeWriteQueueCount = 0;

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const enqueueTime = Date.now();
  activeWriteQueueCount++;

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
    return await operation();
  };

  const result = writeQueue.then(queuedOperation);
  // Chain the next task, catching any errors to ensure subsequent queue operations still run.
  writeQueue = result.then(
    () => {},
    () => {}
  );
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
    });
  });
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
    });
  });
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
          reject(err);
        }
      }
    };

    request.onerror = () => {
      reject(request.error);
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

    try {
      const key = await getOrCreateCryptoKey(db);
      if (clonedSettings.api && clonedSettings.api.apiKey) {
        clonedSettings.api.apiKey = await encryptValue(clonedSettings.api.apiKey, key);
      }
      if (clonedSettings.savedApiProfiles && Array.isArray(clonedSettings.savedApiProfiles)) {
        for (const profile of clonedSettings.savedApiProfiles) {
          if (profile.apiKey) {
            profile.apiKey = await encryptValue(profile.apiKey, key);
          }
        }
      }
    } catch (err) {
      console.error("[localDB] Failed to encrypt settings API keys prior to storage:", err);
    }

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(clonedSettings, "user_settings");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
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
    });
  });
}

