import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
} from "../types";
import { reportDbQueueTimeout } from "./telemetry";

const DB_NAME = "MobileTavernLiteDB";
const DB_VERSION = 5;

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

// === Settings Helper ===

export async function getStoredSettings(): Promise<UserSettings | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("user_settings");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredSettings(
  settings: UserSettings,
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.put(settings, "user_settings");

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
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
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
      const transaction = db.transaction("settings", "readwrite");
      const store = transaction.objectStore("settings");
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
