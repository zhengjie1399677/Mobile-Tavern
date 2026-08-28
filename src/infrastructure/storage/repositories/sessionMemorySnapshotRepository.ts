import type {
  MemoryDictEntry,
  MemoryFragment,
  TemporalFact,
} from "../../../application/services/memory/types";
import { getDB } from "../idbConnection";
import { bindTransactionAbort, enqueueWrite } from "../idbQueue";

export interface SessionMemorySnapshot {
  dictEntries: MemoryDictEntry[];
  fragments: MemoryFragment[];
  facts: TemporalFact[];
}

/** 恢复单会话记忆分轨；调用方已负责把所有 sessionId 与来源消息 ID 重映射。 */
export function restoreSessionMemorySnapshot(
  snapshot: SessionMemorySnapshot,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (context) => {
    const database = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ["memory_dict", "memory_fragments", "memory_facts"],
        "readwrite",
      );
      for (const entry of snapshot.dictEntries) transaction.objectStore("memory_dict").put(entry);
      for (const fragment of snapshot.fragments) transaction.objectStore("memory_fragments").put(fragment);
      for (const fact of snapshot.facts) transaction.objectStore("memory_facts").put(fact);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(context, transaction, reject);
    });
  }, undefined, signal);
}
