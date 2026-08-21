import type {
  LocalResourceContentRecord,
  LocalResourceMetadata,
} from "../../domain/resources/types";

const DB_NAME = "MobileTavernResourceDB";
const DB_VERSION = 1;
const METADATA_STORE = "metadata";
const CONTENT_STORE = "contents";

let openedDb: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export async function listLocalResourceMetadata(): Promise<LocalResourceMetadata[]> {
  const records = await request<LocalResourceMetadata[]>((await readyStore(METADATA_STORE)).getAll());
  return records.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function loadLocalResourceContent(id: string): Promise<Blob | null> {
  const record = await request<LocalResourceContentRecord | undefined>(
    (await readyStore(CONTENT_STORE)).get(id),
  );
  return record?.blob ?? null;
}

export async function saveLocalResource(metadata: LocalResourceMetadata, blob: Blob): Promise<void> {
  const db = await openLocalResourceDb();
  const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");
  transaction.objectStore(METADATA_STORE).put(metadata);
  transaction.objectStore(CONTENT_STORE).put({ id: metadata.id, blob } satisfies LocalResourceContentRecord);
  await transactionDone(transaction);
}

export async function deleteLocalResource(id: string): Promise<void> {
  const db = await openLocalResourceDb();
  const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");
  transaction.objectStore(METADATA_STORE).delete(id);
  transaction.objectStore(CONTENT_STORE).delete(id);
  await transactionDone(transaction);
}

async function openLocalResourceDb(): Promise<IDBDatabase> {
  if (openedDb) return openedDb;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, DB_VERSION);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CONTENT_STORE)) {
          db.createObjectStore(CONTENT_STORE, { keyPath: "id" });
        }
      };
      opening.onsuccess = () => {
        openedDb = opening.result;
        openedDb.onversionchange = () => {
          openedDb?.close();
          openedDb = null;
          dbPromise = null;
        };
        resolve(openedDb);
      };
      opening.onerror = () => reject(opening.error ?? new Error("LOCAL_RESOURCE_DB_OPEN_FAILED"));
    });
  }
  return dbPromise;
}

async function readyStore(name: string): Promise<IDBObjectStore> {
  const db = await openLocalResourceDb();
  return db.transaction(name, "readonly").objectStore(name);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("LOCAL_RESOURCE_DB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("LOCAL_RESOURCE_DB_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("LOCAL_RESOURCE_DB_TRANSACTION_ABORTED"));
  });
}

export const __localResourceStorageTest = {
  async reset(): Promise<void> {
    openedDb?.close();
    openedDb = null;
    dbPromise = null;
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error ?? new Error("LOCAL_RESOURCE_DB_DELETE_FAILED"));
      deletion.onblocked = () => reject(new Error("LOCAL_RESOURCE_DB_DELETE_BLOCKED"));
    });
  },
};
