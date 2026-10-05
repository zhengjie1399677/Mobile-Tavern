/**
 * 外部能力源配置的物理存储。
 *
 * 与 Tool Plugin 一样使用独立 IndexedDB，避免改动主库版本与迁移路径；
 * 只保存配置与凭据**引用**，任何秘密都不落在本库。
 */
import {
  externalCapabilitySourceSchema,
  type ExternalCapabilitySource,
} from "../../domain/externalSources/contracts";

const DB_NAME = "MobileTavernExternalSourceDB";
const DB_VERSION = 1;
const SOURCES_STORE = "sources";

export interface StoredExternalSource extends ExternalCapabilitySource {
  readonly createdAt: number;
  readonly updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error("EXTERNAL_SOURCE_DB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("EXTERNAL_SOURCE_DB_TX_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("EXTERNAL_SOURCE_DB_TX_ABORTED"));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SOURCES_STORE)) {
        db.createObjectStore(SOURCES_STORE, { keyPath: "id" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("EXTERNAL_SOURCE_DB_OPEN_FAILED"));
  });
  return dbPromise;
}

async function readyStore(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  const db = await openDb();
  const tx = db.transaction(SOURCES_STORE, mode);
  return { store: tx.objectStore(SOURCES_STORE), tx };
}

/** 只挑出契约字段，避免把存储元数据（createdAt/updatedAt）喂给严格 Schema。 */
function toSourceInput(record: StoredExternalSource): ExternalCapabilitySource {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    kind: record.kind,
    displayName: record.displayName,
    endpoint: record.endpoint,
    transport: record.transport,
    era: record.era,
    ...(record.authRef ? { authRef: record.authRef } : {}),
    enabled: record.enabled,
  };
}

export async function listExternalSources(): Promise<StoredExternalSource[]> {
  const { store } = await readyStore("readonly");
  const records = await request<StoredExternalSource[]>(store.getAll());
  return records
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => structuredClone(record));
}

export async function getExternalSource(id: string): Promise<StoredExternalSource | null> {
  const { store } = await readyStore("readonly");
  const record = await request<StoredExternalSource | undefined>(store.get(id));
  return record ? structuredClone(record) : null;
}

/** 新增或覆盖一个来源；配置一律经 Zod 收口后再落库。 */
export async function upsertExternalSource(
  input: unknown,
  now = Date.now(),
): Promise<StoredExternalSource> {
  const source = externalCapabilitySourceSchema.parse(input);
  const previous = await getExternalSource(source.id);
  const record: StoredExternalSource = {
    ...source,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const { store, tx } = await readyStore("readwrite");
  store.put(record);
  await transactionDone(tx);
  return structuredClone(record);
}

export async function setExternalSourceEnabled(
  id: string,
  enabled: boolean,
  now = Date.now(),
): Promise<StoredExternalSource> {
  const current = await getExternalSource(id);
  if (!current) throw new Error("EXTERNAL_SOURCE_NOT_FOUND");
  return upsertExternalSource({ ...toSourceInput(current), enabled }, now);
}

/** 删除来源；调用方负责在此之前关闭已建立的连接。 */
export async function deleteExternalSource(id: string): Promise<void> {
  const { store, tx } = await readyStore("readwrite");
  store.delete(id);
  await transactionDone(tx);
}

/** 仅测试使用：释放连接并删除整个来源库。 */
export const __externalSourceStorageTest = {
  async reset(): Promise<void> {
    if (dbPromise) {
      const db = await dbPromise.catch(() => null);
      db?.close();
      dbPromise = null;
    }
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () =>
        reject(deletion.error ?? new Error("EXTERNAL_SOURCE_DB_DELETE_FAILED"));
      deletion.onblocked = () => resolve();
    });
  },
};
