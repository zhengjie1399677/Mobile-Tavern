import type {
  FavoriteSessionBackupMetadata,
  FavoriteSessionBackupPayload,
} from "../../domain/session-management";

const DB_NAME = "MobileTavernSessionBackupDB";
const DB_VERSION = 1;
const METADATA_STORE = "metadata";
const VERSION_STORE = "versions";

interface StoredBackupVersion {
  id: string;
  backupId: string;
  integrityHash: string;
  payload: FavoriteSessionBackupPayload;
}

let openedDb: IDBDatabase | null = null;
let openingPromise: Promise<IDBDatabase> | null = null;

export async function listFavoriteSessionBackups(): Promise<FavoriteSessionBackupMetadata[]> {
  const database = await openDatabase();
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const request = transaction.objectStore(METADATA_STORE).getAll();
  const records = await requestResult<FavoriteSessionBackupMetadata[]>(request);
  await transactionDone(transaction);
  return records.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export async function getFavoriteSessionBackupMetadata(
  backupId: string,
): Promise<FavoriteSessionBackupMetadata | null> {
  const database = await openDatabase();
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const request = transaction.objectStore(METADATA_STORE).get(backupId);
  const record = await requestResult<FavoriteSessionBackupMetadata | undefined>(request);
  await transactionDone(transaction);
  return record ?? null;
}

export async function getFavoriteSessionBackupBySource(
  sourceSessionId: string,
): Promise<FavoriteSessionBackupMetadata | null> {
  const database = await openDatabase();
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const request = transaction.objectStore(METADATA_STORE)
    .index("sourceSessionId")
    .get(sourceSessionId);
  const record = await requestResult<FavoriteSessionBackupMetadata | undefined>(request);
  await transactionDone(transaction);
  return record ?? null;
}

export async function loadFavoriteSessionBackup(
  backupId: string,
): Promise<{ metadata: FavoriteSessionBackupMetadata; payload: FavoriteSessionBackupPayload }> {
  const metadata = await getFavoriteSessionBackupMetadata(backupId);
  if (!metadata) throw new Error("SESSION_BACKUP_NOT_FOUND");
  const database = await openDatabase();
  const transaction = database.transaction(VERSION_STORE, "readonly");
  const request = transaction.objectStore(VERSION_STORE).get(metadata.versionId);
  const version = await requestResult<StoredBackupVersion | undefined>(request);
  await transactionDone(transaction);
  if (!version || version.backupId !== backupId || version.integrityHash !== metadata.integrityHash) {
    throw new Error("SESSION_BACKUP_INTEGRITY_FAILED");
  }
  const actualHash = await hashBackupPayload(version.payload);
  if (actualHash !== metadata.integrityHash) throw new Error("SESSION_BACKUP_INTEGRITY_FAILED");
  return { metadata, payload: structuredClone(version.payload) };
}

/**
 * 新版本先独立写入并回读校验，确认完整后才切换元数据指针并回收旧版本。
 * 更新失败时旧指针保持不变，符合跨库收藏备份的 fail-safe 语义。
 */
export async function saveFavoriteSessionBackup(
  metadataInput: Omit<FavoriteSessionBackupMetadata, "versionId" | "integrityHash">,
  payload: FavoriteSessionBackupPayload,
): Promise<FavoriteSessionBackupMetadata> {
  const database = await openDatabase();
  const integrityHash = await hashBackupPayload(payload);
  const versionId = `session_backup_version_${crypto.randomUUID()}`;
  const metadata: FavoriteSessionBackupMetadata = {
    ...metadataInput,
    versionId,
    integrityHash,
  };
  const previous = await getFavoriteSessionBackupMetadata(metadata.id);
  const version: StoredBackupVersion = {
    id: versionId,
    backupId: metadata.id,
    integrityHash,
    payload: structuredClone(payload),
  };

  const stageTransaction = database.transaction(VERSION_STORE, "readwrite");
  stageTransaction.objectStore(VERSION_STORE).put(version);
  await transactionDone(stageTransaction);

  const verificationTransaction = database.transaction(VERSION_STORE, "readonly");
  const verificationRequest = verificationTransaction.objectStore(VERSION_STORE).get(versionId);
  const staged = await requestResult<StoredBackupVersion | undefined>(verificationRequest);
  await transactionDone(verificationTransaction);
  if (!staged || await hashBackupPayload(staged.payload) !== integrityHash) {
    await deleteVersion(versionId);
    throw new Error("SESSION_BACKUP_INTEGRITY_FAILED");
  }

  const switchTransaction = database.transaction([METADATA_STORE, VERSION_STORE], "readwrite");
  switchTransaction.objectStore(METADATA_STORE).put(metadata);
  if (previous?.versionId && previous.versionId !== versionId) {
    switchTransaction.objectStore(VERSION_STORE).delete(previous.versionId);
  }
  await transactionDone(switchTransaction);
  return metadata;
}

export async function deleteFavoriteSessionBackup(backupId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([METADATA_STORE, VERSION_STORE], "readwrite");
  transaction.objectStore(METADATA_STORE).delete(backupId);
  const request = transaction.objectStore(VERSION_STORE)
    .index("backupId")
    .openKeyCursor(IDBKeyRange.only(backupId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(VERSION_STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function hashBackupPayload(payload: FavoriteSessionBackupPayload): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (openedDb) return Promise.resolve(openedDb);
  if (!openingPromise) {
    openingPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          const metadata = database.createObjectStore(METADATA_STORE, { keyPath: "id" });
          metadata.createIndex("sourceSessionId", "sourceSessionId", { unique: true });
          metadata.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(VERSION_STORE)) {
          const versions = database.createObjectStore(VERSION_STORE, { keyPath: "id" });
          versions.createIndex("backupId", "backupId", { unique: false });
        }
      };
      request.onsuccess = () => {
        openedDb = request.result;
        openedDb.onversionchange = closeDatabase;
        resolve(openedDb);
      };
      request.onerror = () => {
        openingPromise = null;
        reject(request.error ?? new Error("SESSION_BACKUP_DATABASE_OPEN_FAILED"));
      };
    });
  }
  return openingPromise;
}

function closeDatabase(): void {
  openedDb?.close();
  openedDb = null;
  openingPromise = null;
}

async function deleteVersion(versionId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(VERSION_STORE, "readwrite");
  transaction.objectStore(VERSION_STORE).delete(versionId);
  await transactionDone(transaction);
}

function requestResult<TValue>(request: IDBRequest<TValue>): Promise<TValue> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("SESSION_BACKUP_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("SESSION_BACKUP_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("SESSION_BACKUP_TRANSACTION_ABORTED"));
  });
}

export const __sessionBackupStorageTest = { close: closeDatabase };
