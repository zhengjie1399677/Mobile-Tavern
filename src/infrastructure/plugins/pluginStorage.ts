import type { InstalledFullscreenPlugin, PluginSaveRecord } from "../../domain/plugins";

const DB_NAME = "MobileTavernPluginDB";
const DB_VERSION = 2;
const PACKAGES_STORE = "packages";
const PACKAGE_FILES_STORE = "packageFiles";
const SAVES_STORE = "saves";
export const PLUGIN_SAVE_LIMIT_BYTES = 1024 * 1024;

export type InstalledPluginMetadata = Omit<InstalledFullscreenPlugin, "files">;

interface PluginFileRecord {
  pluginId: string;
  files: Record<string, Uint8Array>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export async function listInstalledPlugins(): Promise<InstalledPluginMetadata[]> {
  const records = await request<(InstalledFullscreenPlugin & { files?: Record<string, Uint8Array> })[]>(
    (await readyStore(PACKAGES_STORE)).getAll()
  );
  // 兼容性兜底：剥离可能残留的 files 字段，避免列表视图持有文件字节导致内存峰值。
  return records
    .map(({ files: _files, ...meta }) => meta as InstalledPluginMetadata)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadPluginFiles(pluginId: string): Promise<Record<string, Uint8Array>> {
  const record = await request<PluginFileRecord | undefined>(
    (await readyStore(PACKAGE_FILES_STORE)).get(pluginId)
  );
  if (record?.files) return record.files;
  // 迁移窗口期兜底：packageFiles 缺失时回退查 packages 记录上残留的 files 字段。
  const legacy = await request<(InstalledFullscreenPlugin & { files?: Record<string, Uint8Array> }) | undefined>(
    (await readyStore(PACKAGES_STORE)).get(pluginId)
  );
  return legacy?.files ?? {};
}

export async function installPlugin(record: InstalledFullscreenPlugin): Promise<void> {
  const db = await openPluginDb();
  const transaction = db.transaction([PACKAGES_STORE, PACKAGE_FILES_STORE], "readwrite");
  const { files, ...meta } = record;
  transaction.objectStore(PACKAGES_STORE).put(meta as InstalledPluginMetadata);
  transaction.objectStore(PACKAGE_FILES_STORE).put({ pluginId: record.id, files } satisfies PluginFileRecord);
  await transactionDone(transaction);
}

export async function deletePlugin(pluginId: string): Promise<void> {
  const db = await openPluginDb();
  const transaction = db.transaction([PACKAGES_STORE, PACKAGE_FILES_STORE, SAVES_STORE], "readwrite");
  transaction.objectStore(PACKAGES_STORE).delete(pluginId);
  transaction.objectStore(PACKAGE_FILES_STORE).delete(pluginId);
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
      opening.onupgradeneeded = (event) => {
        const db = opening.result;
        const oldVersion = event.oldVersion;
        if (!db.objectStoreNames.contains(PACKAGES_STORE)) db.createObjectStore(PACKAGES_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SAVES_STORE)) db.createObjectStore(SAVES_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(PACKAGE_FILES_STORE)) {
          db.createObjectStore(PACKAGE_FILES_STORE, { keyPath: "pluginId" });
        }
        // v1→v2 迁移：把 packages 记录上残留的 files 字节物理拆到 packageFiles，列表视图不再持有字节。
        // 幂等：以 record.files 是否存在为迁移信号，中断后重启会跳过已迁移项。
        if (oldVersion >= 1 && oldVersion < 2 && opening.transaction) {
          const packages = opening.transaction.objectStore(PACKAGES_STORE);
          const packageFiles = opening.transaction.objectStore(PACKAGE_FILES_STORE);
          packages.openCursor().onsuccess = (cursorEvent) => {
            const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) return;
            const record = cursor.value as InstalledFullscreenPlugin & { files?: Record<string, Uint8Array> };
            if (record.files) {
              packageFiles.put({ pluginId: record.id, files: record.files });
              delete record.files;
              cursor.update(record);
            }
            cursor.continue();
          };
        }
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
  // 模拟 v1 安装：以旧 schema（packages 含 files、无 packageFiles store）直接写入完整记录。
  async seedV1Record(plugin: InstalledFullscreenPlugin): Promise<void> {
    openedDb?.close();
    openedDb = null;
    dbPromise = null;
    // 先删除现有库（可能已是 v2），再以 v1 schema 重建，模拟旧版本安装现场。
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error("PLUGIN_DB_DELETE_BLOCKED"));
    });
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(PACKAGES_STORE)) db.createObjectStore(PACKAGES_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SAVES_STORE)) db.createObjectStore(SAVES_STORE, { keyPath: "key" });
      };
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction(PACKAGES_STORE, "readwrite");
        tx.objectStore(PACKAGES_STORE).put(plugin);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("PLUGIN_DB_TRANSACTION_ABORTED"));
      };
      opening.onerror = () => reject(opening.error);
    });
  },
  // 重新以当前版本打开，触发 v1→v2 onupgradeneeded 迁移。
  async reopenWithCurrentVersion(): Promise<void> {
    openedDb?.close();
    openedDb = null;
    dbPromise = null;
    await openPluginDb();
  },
  readyStore,
};
