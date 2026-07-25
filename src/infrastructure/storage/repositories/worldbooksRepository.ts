/**
 * Worldbooks Store 仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 worldbooks Store 的 CRUD，
 * 不涉及连接管理、写队列、加密或 schema。
 *
 * Worldbooks Store 使用单条记录 "custom_worldbooks" 存储所有自定义世界书集
 * （Record<id, CustomWorldbook>），便于一次性整体读写。
 */

import type { CustomWorldbook } from "../../../types";
import { getDB } from "../idbConnection";
import {
  enqueueWrite,
  bindTransactionAbort,
  bindReadonlyTransactionAbort,
} from "../idbQueue";

export async function getCustomWorldbooks(): Promise<Record<string, CustomWorldbook>> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("worldbooks", "readonly");
    const store = transaction.objectStore("worldbooks");
    const request = store.get("custom_worldbooks");

    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveCustomWorldbooks(
  worldbooks: Record<string, CustomWorldbook>,
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("worldbooks", "readwrite");
      const store = transaction.objectStore("worldbooks");
      const request = store.put(worldbooks, "custom_worldbooks");
      // 用 oncomplete 判定成功（详见 charactersRepository.saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}
