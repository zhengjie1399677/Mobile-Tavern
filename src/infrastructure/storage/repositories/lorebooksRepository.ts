/**
 * Lorebooks Store 仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 lorebooks Store 的 CRUD，
 * 不涉及连接管理、写队列、加密或 schema。
 *
 * Lorebooks Store 使用单条记录 "global_lorebook" 存储全局世界书条目数组，
 * 而非每条 entry 一个记录，避免扫描索引时 N 次 IDB round-trip。
 */

import type { LorebookEntry } from "../../../types";
import { getDB } from "../idbConnection";
import {
  enqueueWrite,
  bindTransactionAbort,
  bindReadonlyTransactionAbort,
} from "../idbQueue";

export async function getGlobalLorebook(): Promise<LorebookEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("lorebooks", "readonly");
    const store = transaction.objectStore("lorebooks");
    const request = store.get("global_lorebook");

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveGlobalLorebook(
  entries: LorebookEntry[],
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("lorebooks", "readwrite");
      const store = transaction.objectStore("lorebooks");
      const request = store.put(entries, "global_lorebook");
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}
