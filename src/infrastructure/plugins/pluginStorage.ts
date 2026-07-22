import type { InstalledFullscreenPlugin, PluginSaveRecord } from "../../domain/plugins";

const DB_NAME = "MobileTavernPluginDB";
const DB_VERSION = 1;
const PACKAGES_STORE = "packages";
const SAVES_STORE = "saves";
export const PLUGIN_SAVE_LIMIT_BYTES = 1024 * 1024;

let dbPromise: Promise<IDBDatabase> | null = null;

export async function listInstalledPlugins(): Promise<InstalledFullscreenPlugin[]> {
  const records = await request<InstalledFullscreenPlugin[]>((await readyStore(PACKAGES_STORE)).getAll());
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function installPlugin(record: InstalledFullscreenPlugin): Promise<void> {
  await request((await readyStore(PACKAGES_STORE, "readwrite")).put(record));
}

export async function deletePlugin(pluginId: string): Promise<void> {
  const db = await openPluginDb();
  const transaction = db.transaction([PACKAGES_STORE, SAVES_STORE], "readwrite");
  transaction.objectStore(PACKAGES_STORE).delete(pluginId);
  const saves = transaction.objectStore(SAVES_STORE);
  const allKeys = await request<IDBValidKey[]>(saves.getAllKeys());
  for (const key of allKeys) {
    if (typeof key === "string" && key.startsWith(`${pluginId}:`)) saves.delete(key);
  }
  await transactionDone(transaction);
}

export async function savePluginData(pluginId: string, slot: string, data: unknown): Promise<void> {
  validateSlot(slot);
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    throw new Error("PLUGIN_SAVE_NOT_SERIALIZABLE");
  }
  if (new TextEncoder().encode(serialized).byteLength > PLUGIN_SAVE_LIMIT_BYTES) {
    throw new Error("PLUGIN_SAVE_TOO_LARGE");
  }
  const record: PluginSaveRecord = {
    key: `${pluginId}:${slot}`,
    pluginId,
    slot,
    data: JSON.parse(serialized),
    updatedAt: Date.now(),
  };
  await request((await readyStore(SAVES_STORE, "readwrite")).put(record));
}

export async function loadPluginData(pluginId: string, slot: string): Promise<unknown | null> {
  validateSlot(slot);
  const record = await request<PluginSaveRecord | undefined>((await readyStore(SAVES_STORE)).get(`${pluginId}:${slot}`));
  return record?.data ?? null;
}

export async function deletePluginData(pluginId: string, slot: string): Promise<void> {
  validateSlot(slot);
  await request((await readyStore(SAVES_STORE, "readwrite")).delete(`${pluginId}:${slot}`));
}

function validateSlot(slot: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(slot)) throw new Error("PLUGIN_SAVE_INVALID_SLOT");
}

let openedDb: IDBDatabase | null = null;
async function openPluginDb(): Promise<IDBDatabase> {
  if (openedDb) return openedDb;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, DB_VERSION);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(PACKAGES_STORE)) db.createObjectStore(PACKAGES_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SAVES_STORE)) db.createObjectStore(SAVES_STORE, { keyPath: "key" });
      };
      opening.onsuccess = () => {
        openedDb = opening.result;
        openedDb.onversionchange = () => openedDb?.close();
        resolve(openedDb);
      };
      opening.onerror = () => reject(opening.error ?? new Error("PLUGIN_DB_OPEN_FAILED"));
    });
  }
  return dbPromise;
}

async function readyStore(name: string, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  const db = await openPluginDb();
  return db.transaction(name, mode).objectStore(name);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("PLUGIN_DB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("PLUGIN_DB_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("PLUGIN_DB_TRANSACTION_ABORTED"));
  });
}

export const __pluginStorageTest = {
  async reset(): Promise<void> {
    openedDb?.close();
    openedDb = null;
    dbPromise = null;
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error("PLUGIN_DB_DELETE_BLOCKED"));
    });
    await openPluginDb();
  },
  readyStore,
};
