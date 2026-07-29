/**
 * Characters Store 仓库。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心 characters Store 的 CRUD，
 * 不涉及连接管理、写队列、加密或 schema。
 */

import type { CharacterCard } from "../../../types";
import { getDB } from "../idbConnection";
import {
  enqueueWrite,
  bindTransactionAbort,
  bindReadonlyTransactionAbort,
} from "../idbQueue";
import { toCharacterCatalogRecord } from "../dbSchema";

/** 首屏专用轻量目录，仅额外读取展示所需 avatar，不读取世界书、脚本或问候语。 */
export async function getCharacterCatalog(): Promise<CharacterCard[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("character_catalog", "readonly");
    const request = transaction.objectStore("character_catalog").getAll();
    request.onsuccess = () => resolve((request.result || []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || "",
      avatar: item.avatar || "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator: item.creator,
      tags: item.tags || [],
      extensions: { __catalogOnly: true },
    })));
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function getAllCharacters(): Promise<CharacterCard[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readonly");
    const store = transaction.objectStore("characters");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/**
 * 按主键单条直查角色卡。走主键索引毫秒级返回，避免 getAll() 全量反序列化。
 */
export async function getCharacterById(
  id: string
): Promise<CharacterCard | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readonly");
    const store = transaction.objectStore("characters");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

export async function saveCharacter(character: CharacterCard, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["characters", "character_catalog"], "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.put(character);
      transaction.objectStore("character_catalog").put(toCharacterCatalogRecord(character));

      // 用 oncomplete 判定成功：request.onsuccess 仅表示请求入队成功，不保证事务 commit。
      // commit 前若发生 QuotaExceededError 等错误，事务 abort 但 resolve() 已被调用，
      // 调用方误以为写入成功。改用 oncomplete 确保事务真正落盘。
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, `character:${character.id}`, signal);  // P1-11: 同角色卡多次保存合并为一次落盘
}

export async function deleteCharacter(id: string, signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["characters", "character_catalog"], "readwrite");
      const store = transaction.objectStore("characters");
      const request = store.delete(id);
      transaction.objectStore("character_catalog").delete(id);

      // 用 oncomplete 判定成功（详见 saveCharacter 注释）
      transaction.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, undefined, signal);
}

export async function bulkSaveCharacters(charactersList: CharacterCard[], signal?: AbortSignal): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      if (charactersList.length === 0) return resolve();
      const transaction = db.transaction(["characters", "character_catalog"], "readwrite");
      const store = transaction.objectStore("characters");
      const catalog = transaction.objectStore("character_catalog");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      bindTransactionAbort(ctx, transaction, reject);

      for (const char of charactersList) {
        store.put(char);
        catalog.put(toCharacterCatalogRecord(char));
      }
    });
  }, undefined, signal);
}
