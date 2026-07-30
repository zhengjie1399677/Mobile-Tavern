import { getDB } from "./idbConnection";

export interface StorageDiagnosticsSnapshot {
  databaseName: string;
  version: number;
  storeNames: string[];
  recordCounts: Record<string, number>;
  writeLatencyMs: number;
  readWriteVerified: boolean;
}

const DIAGNOSTIC_KEY = "diagnose_transient_key";

/** 执行一次受控的 IndexedDB 读写闭环诊断，调用方不直接接触 IDB 事务。 */
export async function runStorageDiagnostics(): Promise<StorageDiagnosticsSnapshot> {
  const db = await getDB();
  const storeNames = Array.from(db.objectStoreNames);
  const recordCounts: Record<string, number> = {};

  for (const storeName of storeNames) {
    const tx = db.transaction(storeName, "readonly");
    recordCounts[storeName] = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const testTimestamp = Date.now();
  const writeStartedAt = Date.now();
  const writeTx = db.transaction("settings", "readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = writeTx.objectStore("settings").put(
      { id: DIAGNOSTIC_KEY, value: testTimestamp },
      DIAGNOSTIC_KEY,
    );
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  const writeLatencyMs = Date.now() - writeStartedAt;

  const readTx = db.transaction("settings", "readonly");
  const readValue = await new Promise<unknown>((resolve, reject) => {
    const request = readTx.objectStore("settings").get(DIAGNOSTIC_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readWriteVerified =
    typeof readValue === "object" &&
    readValue !== null &&
    "value" in readValue &&
    (readValue as { value?: unknown }).value === testTimestamp;

  const deleteTx = db.transaction("settings", "readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = deleteTx.objectStore("settings").delete(DIAGNOSTIC_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  return {
    databaseName: db.name,
    version: db.version,
    storeNames,
    recordCounts,
    writeLatencyMs,
    readWriteVerified,
  };
}
