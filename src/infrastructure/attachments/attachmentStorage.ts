import type {
  AttachmentContentRecord,
  AttachmentMetadata,
  AttachmentReference,
} from "../../domain/attachments/types";

const DB_NAME = "MobileTavernAttachmentDB";
const DB_VERSION = 1;
const METADATA_STORE = "metadata";
const CONTENT_STORE = "contents";

let openedDb: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export async function listAttachmentMetadata(): Promise<AttachmentMetadata[]> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(METADATA_STORE, "readonly");
  const records = await request<AttachmentMetadata[]>(transaction.objectStore(METADATA_STORE).getAll());
  await transactionDone(transaction);
  return records.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export async function loadAttachmentMetadata(id: string): Promise<AttachmentMetadata | null> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(METADATA_STORE, "readonly");
  const record = await request<AttachmentMetadata | undefined>(transaction.objectStore(METADATA_STORE).get(id));
  await transactionDone(transaction);
  return record ?? null;
}

export async function loadAttachmentContent(id: string): Promise<Blob | null> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(CONTENT_STORE, "readonly");
  const record = await request<AttachmentContentRecord | undefined>(transaction.objectStore(CONTENT_STORE).get(id));
  await transactionDone(transaction);
  return record ? new Blob([record.bytes], { type: record.mimeType }) : null;
}

export async function saveStagedAttachment(metadata: AttachmentMetadata, blob: Blob): Promise<void> {
  const bytes = await blob.arrayBuffer();
  const db = await openAttachmentDb();
  const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");
  transaction.objectStore(METADATA_STORE).add(metadata);
  transaction.objectStore(CONTENT_STORE).add({
    id: metadata.id,
    bytes,
    mimeType: metadata.mimeType,
  } satisfies AttachmentContentRecord);
  await transactionDone(transaction);
}

/**
 * 以完整消息引用快照重建反向引用。缺少任意附件时事务整体中止，避免半提交。
 */
export async function reconcileAttachmentReferences(
  references: readonly AttachmentReference[],
  now = Date.now(),
): Promise<void> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(METADATA_STORE, "readwrite");
  const store = transaction.objectStore(METADATA_STORE);
  try {
    const records = await request<AttachmentMetadata[]>(store.getAll());
    const byId = new Map(records.map(record => [record.id, record]));
    const referenceIdsByAsset = new Map<string, Set<string>>();

    for (const reference of references) {
      for (const assetId of new Set(reference.assetIds)) {
        if (!byId.has(assetId)) throw new Error("ATTACHMENT_NOT_FOUND");
        const referenceIds = referenceIdsByAsset.get(assetId) ?? new Set<string>();
        referenceIds.add(reference.referenceId);
        referenceIdsByAsset.set(assetId, referenceIds);
      }
    }

    for (const record of records) {
      const nextReferenceIds = Array.from(referenceIdsByAsset.get(record.id) ?? []).sort();
      const nextState = nextReferenceIds.length > 0
        ? "committed"
        : record.state === "committed"
          ? "orphaned"
          : record.state;
      const unchanged = nextState === record.state
        && nextReferenceIds.length === record.referenceIds.length
        && nextReferenceIds.every((value, index) => value === record.referenceIds[index]);
      if (unchanged) continue;
      store.put({
        ...record,
        state: nextState,
        referenceIds: nextReferenceIds,
        updatedAt: now,
      } satisfies AttachmentMetadata);
    }
    await transactionDone(transaction);
  } catch (error) {
    transaction.abort();
    await transactionSettled(transaction);
    throw error;
  }
}

/** 增量更新指定消息引用；未列出的其他消息引用保持不变。 */
export async function patchAttachmentReferences(
  references: readonly AttachmentReference[],
  removedReferenceIds: readonly string[] = [],
  now = Date.now(),
): Promise<void> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(METADATA_STORE, "readwrite");
  const store = transaction.objectStore(METADATA_STORE);
  try {
    const records = await request<AttachmentMetadata[]>(store.getAll());
    const byId = new Map(records.map(record => [record.id, record]));
    const updatedReferenceIds = new Set(references.map(reference => reference.referenceId));
    const removed = new Set(removedReferenceIds);
    const assetsByReference = new Map<string, Set<string>>();
    for (const reference of references) {
      const assetIds = assetsByReference.get(reference.referenceId) ?? new Set<string>();
      for (const assetId of reference.assetIds) {
        if (!byId.has(assetId)) throw new Error("ATTACHMENT_NOT_FOUND");
        assetIds.add(assetId);
      }
      assetsByReference.set(reference.referenceId, assetIds);
    }

    for (const record of records) {
      const nextReferences = new Set(record.referenceIds.filter(referenceId =>
        !updatedReferenceIds.has(referenceId) && !removed.has(referenceId),
      ));
      for (const [referenceId, assetIds] of assetsByReference) {
        if (assetIds.has(record.id)) nextReferences.add(referenceId);
      }
      const nextReferenceIds = Array.from(nextReferences).sort();
      const nextState = nextReferenceIds.length > 0
        ? "committed"
        : record.state === "committed"
          ? "orphaned"
          : record.state;
      const unchanged = nextState === record.state
        && nextReferenceIds.length === record.referenceIds.length
        && nextReferenceIds.every((value, index) => value === record.referenceIds[index]);
      if (!unchanged) store.put({
        ...record,
        state: nextState,
        referenceIds: nextReferenceIds,
        updatedAt: now,
      } satisfies AttachmentMetadata);
    }
    await transactionDone(transaction);
  } catch (error) {
    transaction.abort();
    await transactionSettled(transaction);
    throw error;
  }
}

export async function deleteCollectableAttachments(cutoffTime: number): Promise<string[]> {
  const db = await openAttachmentDb();
  const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");
  const metadataStore = transaction.objectStore(METADATA_STORE);
  const records = await request<AttachmentMetadata[]>(metadataStore.getAll());
  const removed = records
    .filter(record => record.state !== "committed" && record.updatedAt <= cutoffTime)
    .map(record => record.id);
  for (const id of removed) {
    metadataStore.delete(id);
    transaction.objectStore(CONTENT_STORE).delete(id);
  }
  await transactionDone(transaction);
  return removed;
}

export async function replaceAttachmentStorage(
  records: ReadonlyArray<{ metadata: AttachmentMetadata; bytes: ArrayBuffer }>,
): Promise<void> {
  const db = await openAttachmentDb();
  const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");
  const metadataStore = transaction.objectStore(METADATA_STORE);
  const contentStore = transaction.objectStore(CONTENT_STORE);
  metadataStore.clear();
  contentStore.clear();
  for (const record of records) {
    metadataStore.add(record.metadata);
    contentStore.add({
      id: record.metadata.id,
      bytes: record.bytes,
      mimeType: record.metadata.mimeType,
    } satisfies AttachmentContentRecord);
  }
  await transactionDone(transaction);
}

async function openAttachmentDb(): Promise<IDBDatabase> {
  if (openedDb) return openedDb;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, DB_VERSION);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const metadata = db.createObjectStore(METADATA_STORE, { keyPath: "id" });
          metadata.createIndex("state", "state", { unique: false });
        }
        if (!db.objectStoreNames.contains(CONTENT_STORE)) {
          db.createObjectStore(CONTENT_STORE, { keyPath: "id" });
        }
      };
      opening.onsuccess = () => {
        openedDb = opening.result;
        openedDb.onversionchange = () => closeConnection();
        resolve(openedDb);
      };
      opening.onerror = () => {
        dbPromise = null;
        reject(opening.error ?? new Error("ATTACHMENT_DB_OPEN_FAILED"));
      };
    });
  }
  return dbPromise;
}

function closeConnection(): void {
  openedDb?.close();
  openedDb = null;
  dbPromise = null;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("ATTACHMENT_DB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("ATTACHMENT_DB_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("ATTACHMENT_DB_TRANSACTION_ABORTED"));
  });
}

function transactionSettled(transaction: IDBTransaction): Promise<void> {
  return new Promise(resolve => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export const __attachmentStorageTest = {
  async reset(): Promise<void> {
    closeConnection();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error ?? new Error("ATTACHMENT_DB_DELETE_FAILED"));
      deletion.onblocked = () => reject(new Error("ATTACHMENT_DB_DELETE_BLOCKED"));
    });
  },
};
