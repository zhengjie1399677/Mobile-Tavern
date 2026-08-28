import type { AgentJournalEvent } from "../../domain/agents/contracts";

const DB_NAME = "MobileTavernAgentJournalDB";
const DB_VERSION = 1;
const EVENT_STORE = "events";

let openedDb: IDBDatabase | null = null;
let openingPromise: Promise<IDBDatabase> | null = null;

/** Agent Journal 物理分轨，避免把工具结果和请求决定塞进 sessions 大对象。 */
export async function appendAgentJournalEvent(event: AgentJournalEvent): Promise<void> {
  const database = await openAgentJournalDatabase();
  const transaction = database.transaction(EVENT_STORE, "readwrite");
  transaction.objectStore(EVENT_STORE).add(event);
  await transactionDone(transaction);
}

/** 在单个事务中追加一组 Journal 事件，不影响其他会话正在写入的记录。 */
export async function appendAgentJournalEvents(
  events: readonly AgentJournalEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const database = await openAgentJournalDatabase();
  const transaction = database.transaction(EVENT_STORE, "readwrite");
  const store = transaction.objectStore(EVENT_STORE);
  for (const event of events) store.add(event);
  await transactionDone(transaction);
}

export async function listAgentJournalEventsBySession(
  sessionId: string,
): Promise<AgentJournalEvent[]> {
  const database = await openAgentJournalDatabase();
  const transaction = database.transaction(EVENT_STORE, "readonly");
  const request = transaction.objectStore(EVENT_STORE)
    .index("sessionId")
    .getAll(IDBKeyRange.only(sessionId));
  const events = await requestResult<AgentJournalEvent[]>(request);
  await transactionDone(transaction);
  return events.sort(compareJournalEvents);
}

export async function replaceAgentJournalEvents(
  events: readonly AgentJournalEvent[],
): Promise<void> {
  const database = await openAgentJournalDatabase();
  const transaction = database.transaction(EVENT_STORE, "readwrite");
  const store = transaction.objectStore(EVENT_STORE);
  store.clear();
  for (const event of events) store.add(event);
  await transactionDone(transaction);
}

export async function deleteAgentJournalBySession(sessionId: string): Promise<void> {
  const database = await openAgentJournalDatabase();
  const transaction = database.transaction(EVENT_STORE, "readwrite");
  const request = transaction.objectStore(EVENT_STORE)
    .index("sessionId")
    .openKeyCursor(IDBKeyRange.only(sessionId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(EVENT_STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionDone(transaction);
}

function openAgentJournalDatabase(): Promise<IDBDatabase> {
  if (openedDb) return Promise.resolve(openedDb);
  if (!openingPromise) {
    openingPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(EVENT_STORE)) return;
        const events = database.createObjectStore(EVENT_STORE, { keyPath: "id" });
        events.createIndex("sessionId", "sessionId", { unique: false });
        events.createIndex("turnId", "turnId", { unique: false });
        events.createIndex("sessionId_createdAt", ["sessionId", "createdAt"], { unique: false });
      };
      request.onsuccess = () => {
        openedDb = request.result;
        openedDb.onversionchange = closeAgentJournalDatabase;
        resolve(openedDb);
      };
      request.onerror = () => {
        openingPromise = null;
        reject(request.error ?? new Error("AGENT_JOURNAL_OPEN_FAILED"));
      };
    });
  }
  return openingPromise;
}

function closeAgentJournalDatabase(): void {
  openedDb?.close();
  openedDb = null;
  openingPromise = null;
}

function requestResult<TValue>(request: IDBRequest<TValue>): Promise<TValue> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("AGENT_JOURNAL_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("AGENT_JOURNAL_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("AGENT_JOURNAL_TRANSACTION_ABORTED"));
  });
}

function compareJournalEvents(left: AgentJournalEvent, right: AgentJournalEvent): number {
  return left.createdAt - right.createdAt
    || left.turnId.localeCompare(right.turnId)
    || left.sequence - right.sequence
    || left.id.localeCompare(right.id);
}

export const __agentJournalStorageTest = {
  close: closeAgentJournalDatabase,
};
