import type { TemporalFact, TemporalFactStatus } from "../../../application/services/memory/types";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";
import { getDB } from "../idbConnection";

// === Memory Facts Store CRUD (v10 实体关系图与时态事实) ===

export async function evolveTemporalFact(
  fact: TemporalFact,
  signal?: AbortSignal,
  options?: { requireSourceMessage?: boolean },
): Promise<{ changed: boolean; fact: TemporalFact }> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        options?.requireSourceMessage
          ? ["messages", "memory_facts"]
          : ["memory_facts"],
        "readwrite",
      );
      const store = transaction.objectStore("memory_facts");
      const index = store.index("sessionId_subject_predicate");
      let result = fact;
      let changed = false;
      const writeFact = () => {
        const request = index.getAll(IDBKeyRange.only([fact.sessionId, fact.subject, fact.predicate]));
        request.onsuccess = () => {
          changed = true;
          const active = (request.result as TemporalFact[])
            .filter((item) => item.status === "active")
            .sort((a, b) => b.validFromTurn - a.validFromTurn)[0];
          if (active?.object === fact.object) {
            changed = false;
            result = {
              ...active,
              confidence: Math.max(active.confidence, fact.confidence),
              tags: Array.from(new Set([...active.tags, ...fact.tags])),
              updatedAt: fact.updatedAt,
            };
            store.put(result);
            return;
          }
          if (active) {
            result = { ...fact, supersedesId: active.id };
            store.put({
              ...active,
              status: "superseded",
              validToTurn: Math.max(active.validFromTurn, fact.validFromTurn - 1),
              supersededById: fact.id,
              updatedAt: fact.updatedAt,
            });
          }
          store.put(result);
        };
        request.onerror = () => reject(request.error);
      };
      if (options?.requireSourceMessage) {
        const sourceRequest = transaction.objectStore("messages").get(fact.sourceMessageId);
        sourceRequest.onsuccess = () => {
          if (sourceRequest.result?.sessionId === fact.sessionId) writeFact();
        };
        sourceRequest.onerror = () => reject(sourceRequest.error);
      } else {
        writeFact();
      }
      transaction.oncomplete = () => resolve({ changed, fact: result });
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fact:${fact.sessionId}:${fact.subject}:${fact.predicate}`, signal);
}

export async function getTemporalFactsBySession(
  sessionId: string,
  options?: { activeOnly?: boolean }
): Promise<TemporalFact[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("memory_facts", "readonly");
    const request = transaction.objectStore("memory_facts").index("sessionId")
      .getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const facts = (request.result as TemporalFact[])
        .filter((fact) => options?.activeOnly !== true || fact.status === "active")
        .sort((a, b) => b.validFromTurn - a.validFromTurn);
      resolve(facts);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getTemporalFactsByEntities(
  sessionId: string,
  entities: string[],
  limit?: number
): Promise<TemporalFact[]> {
  if (entities.length === 0) return [];
  const facts = await getTemporalFactsBySession(sessionId, { activeOnly: true });
  const terms = new Set(entities);
  const matched = facts.filter((fact) =>
    terms.has(fact.subject) || terms.has(fact.object) || fact.tags.some((tag) => terms.has(tag))
  );
  return limit === undefined ? matched : matched.slice(0, limit);
}

export async function updateTemporalFactStatus(
  id: string,
  status: TemporalFactStatus,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_facts", "readwrite");
      const store = transaction.objectStore("memory_facts");
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, status, updatedAt: Date.now() });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `fact:${id}:status`, signal);
}

export async function deleteTemporalFactsBySession(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("memory_facts", "readwrite");
      const request = transaction.objectStore("memory_facts").index("sessionId")
        .openCursor(IDBKeyRange.only(sessionId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `facts:${sessionId}:delete`, signal);
}
