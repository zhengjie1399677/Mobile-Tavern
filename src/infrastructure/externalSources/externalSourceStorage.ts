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
import { decryptValue, encryptValue } from "../storage/settingsCrypto";

const DB_NAME = "MobileTavernExternalSourceDB";
const DB_VERSION = 2;
const SOURCES_STORE = "sources";
const CREDENTIALS_STORE = "credentials";
const META_STORE = "meta";
const CREDENTIAL_KEY_ID = "credential_crypto_key";

export interface StoredExternalSource extends ExternalCapabilitySource {
  readonly createdAt: number;
  readonly updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let credentialKeyPromise: Promise<CryptoKey> | null = null;

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
      if (!db.objectStoreNames.contains(CREDENTIALS_STORE)) {
        db.createObjectStore(CREDENTIALS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("EXTERNAL_SOURCE_DB_OPEN_FAILED"));
  });
  return dbPromise;
}

async function readyStore(
  storeName: string,
  mode: IDBTransactionMode,
): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  return { store: tx.objectStore(storeName), tx };
}

/**
 * 只挑出契约字段，避免把存储元数据（createdAt/updatedAt）喂给严格 Schema。
 *
 * 这是"存储记录 → 运行时契约"的唯一投影入口：所有把读出的来源交给
 * `externalCapabilitySourceSchema` 校验的调用方都必须先经过它，否则 `.strict()`
 * 会把 createdAt/updatedAt 报成 `unrecognized_keys`（线上表现为导入/探测 MCP 来源后
 * 弹出 `Unrecognized keys: "createdAt", "updatedAt"`）。
 */
export function toExternalCapabilitySource(record: StoredExternalSource): ExternalCapabilitySource {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    kind: record.kind,
    displayName: record.displayName,
    endpoint: record.endpoint,
    transport: record.transport,
    era: record.era,
    ...(record.authRef ? { authRef: record.authRef } : {}),
    ...(record.authHeader ? { authHeader: record.authHeader } : {}),
    ...(record.authScheme ? { authScheme: record.authScheme } : {}),
    enabled: record.enabled,
  };
}

export async function listExternalSources(): Promise<StoredExternalSource[]> {
  const { store } = await readyStore(SOURCES_STORE, "readonly");
  const records = await request<StoredExternalSource[]>(store.getAll());
  return records
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => structuredClone(record));
}

export async function getExternalSource(id: string): Promise<StoredExternalSource | null> {
  const { store } = await readyStore(SOURCES_STORE, "readonly");
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
  const { store, tx } = await readyStore(SOURCES_STORE, "readwrite");
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
  return upsertExternalSource({ ...toExternalCapabilitySource(current), enabled }, now);
}

/** 删除来源；调用方负责在此之前关闭已建立的连接。 */
export async function deleteExternalSource(id: string): Promise<void> {
  const { store, tx } = await readyStore(SOURCES_STORE, "readwrite");
  store.delete(id);
  await transactionDone(tx);
}

/** 仅测试使用：释放连接并删除整个来源库。 */
export const __externalSourceStorageTest = {
  /** 仅测试使用：读出凭据原始记录，用于断言落盘内容不是明文。 */
  async dumpCredentials(): Promise<StoredCredential[]> {
    const { store } = await readyStore(CREDENTIALS_STORE, "readonly");
    return request<StoredCredential[]>(store.getAll());
  },

  async reset(): Promise<void> {
    credentialKeyPromise = null;
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

interface StoredCredential {
  key: string;
  encryptedValue: string;
  updatedAt: number;
}

export interface ExternalSourceCredentialStatus {
  readonly key: string;
  readonly configured: boolean;
  readonly updatedAt?: number;
}

async function getCredentialCryptoKey(): Promise<CryptoKey> {
  if (credentialKeyPromise) return credentialKeyPromise;
  credentialKeyPromise = (async () => {
    const { store } = await readyStore(META_STORE, "readonly");
    const existing = await request<CryptoKey | undefined>(store.get(CREDENTIAL_KEY_ID));
    if (existing) return existing;
    // 与主库的 settings 密钥刻意分开：来源库独立密钥，互不影响。
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const writable = await readyStore(META_STORE, "readwrite");
    writable.store.put(key, CREDENTIAL_KEY_ID);
    await transactionDone(writable.tx);
    return key;
  })();
  return credentialKeyPromise;
}

/** 写入（或覆盖）某来源的静态凭据；明文只在内存中存在，落盘前加密。 */
export async function setExternalSourceCredential(
  key: string,
  value: string,
  now = Date.now(),
): Promise<ExternalSourceCredentialStatus> {
  if (key.length === 0) throw new Error("EXTERNAL_SOURCE_CREDENTIAL_KEY_EMPTY");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("EXTERNAL_SOURCE_CREDENTIAL_EMPTY");
  const encryptedValue = await encryptValue(trimmed, await getCredentialCryptoKey());
  const db = await openDb();
  const tx = db.transaction(CREDENTIALS_STORE, "readwrite");
  tx.objectStore(CREDENTIALS_STORE).put({ key, encryptedValue, updatedAt: now } satisfies StoredCredential);
  await transactionDone(tx);
  return { key, configured: true, updatedAt: now };
}

/** 只返回是否已配置与更新时间，绝不返回秘密本身。 */
export async function getExternalSourceCredentialStatus(
  key: string,
): Promise<ExternalSourceCredentialStatus> {
  const db = await openDb();
  const tx = db.transaction(CREDENTIALS_STORE, "readonly");
  const stored = await request<StoredCredential | undefined>(tx.objectStore(CREDENTIALS_STORE).get(key));
  return stored
    ? { key, configured: true, updatedAt: stored.updatedAt }
    : { key, configured: false };
}

/** 解析凭据明文供连接期注入；调用方不得持久化或记录该值。 */
export async function resolveExternalSourceCredential(key: string): Promise<string | null> {
  const db = await openDb();
  const tx = db.transaction(CREDENTIALS_STORE, "readonly");
  const stored = await request<StoredCredential | undefined>(tx.objectStore(CREDENTIALS_STORE).get(key));
  if (!stored) return null;
  return decryptValue(stored.encryptedValue, await getCredentialCryptoKey());
}

export async function deleteExternalSourceCredential(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CREDENTIALS_STORE, "readwrite");
  tx.objectStore(CREDENTIALS_STORE).delete(key);
  await transactionDone(tx);
}
