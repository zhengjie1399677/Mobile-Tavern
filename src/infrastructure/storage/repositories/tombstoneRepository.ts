/**
 * 跨设备同步墓碑的存储访问。
 *
 * 墓碑必须与"删除记录"在同一个 IndexedDB 事务中落库：一旦出现"记录已删、墓碑未写"
 * 的窗口，该次删除就无法传播到其他设备，对端会在下次同步时把数据推回来。
 * 因此本模块对外暴露的写入入口是事务内辅助函数，由各删除路径把自己的事务传进来，
 * 而不是自行开事务。
 */
import type { SyncTombstone } from "../../../domain/sync/tombstones";
import { getDB } from "../idbConnection";
import { bindReadonlyTransactionAbort, bindTransactionAbort, enqueueWrite } from "../idbQueue";

export const SYNC_TOMBSTONE_STORE = "sync_tombstones";

/** 与 keyManager 共用的设备标识键；此处只读不写，未生成过则视为未知设备。 */
const DEVICE_ID_STORAGE_KEY = "mt_device_id";

function resolveDeviceId(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(DEVICE_ID_STORAGE_KEY) || undefined;
  } catch {
    // 隐私模式等场景下 localStorage 可能不可用；设备标识只用于诊断，缺失不影响裁决。
    return undefined;
  }
}

/** 构造会话墓碑。会话墓碑连带覆盖该会话下的全部消息，无需逐条记录。 */
export function buildSessionTombstone(sessionId: string, deletedAt = Date.now()): SyncTombstone {
  return {
    entity: "session",
    targetId: sessionId,
    sessionId,
    deletedAt,
    deviceId: resolveDeviceId(),
  };
}

/** 构造单条消息墓碑，保留所属会话以便按会话诊断与整体清理。 */
export function buildMessageTombstone(
  sessionId: string,
  messageId: string,
  deletedAt = Date.now(),
): SyncTombstone {
  return {
    entity: "message",
    targetId: messageId,
    sessionId,
    deletedAt,
    deviceId: resolveDeviceId(),
  };
}

/**
 * 在调用方已开启的读写事务内写入墓碑。
 *
 * 调用方必须把 `sync_tombstones` 加入自己的 `db.transaction(...)` 范围，
 * 否则这里会因为跨事务抛错（IDB 不允许在事务存活期外使用 store）。
 */
export function putTombstones(
  store: IDBObjectStore,
  tombstones: readonly SyncTombstone[],
): void {
  for (const tombstone of tombstones) store.put(tombstone);
}

/** 读取全部墓碑，供同步导出与合并计算使用。 */
export async function listSyncTombstones(): Promise<SyncTombstone[]> {
  const db = await getDB();
  return new Promise<SyncTombstone[]>((resolve, reject) => {
    const transaction = db.transaction(SYNC_TOMBSTONE_STORE, "readonly");
    const request = transaction.objectStore(SYNC_TOMBSTONE_STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as SyncTombstone[]);
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/**
 * 以给定集合整体替换本地墓碑。
 *
 * 仅在合并落库成功后调用：此时传入的是"双方墓碑合并 + 复活剔除"后的权威集合。
 */
export function replaceSyncTombstones(
  tombstones: readonly SyncTombstone[],
  signal?: AbortSignal,
): Promise<void> {
  return enqueueWrite(async (ctx) => {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SYNC_TOMBSTONE_STORE, "readwrite");
      const store = transaction.objectStore(SYNC_TOMBSTONE_STORE);
      store.clear();
      putTombstones(store, tombstones);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("墓碑替换事务失败"));
      bindTransactionAbort(ctx, transaction, reject);
    });
  }, "sync:tombstones:replace", signal);
}
