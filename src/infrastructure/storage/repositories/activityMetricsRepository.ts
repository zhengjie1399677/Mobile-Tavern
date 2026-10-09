/**
 * 工作台活动聚合的只读查询。
 *
 * 数据权威是 messages Store：`sessions` 记录的内嵌 `messages` 在读取时被强制丢弃
 * （见 sessionRecord.fromSessionStorageRecord），界面只水合激活会话的最近一页，
 * 因此工作台不能再以「已加载消息」为口径。这里在存储边界完成两件事：
 *
 *   1. 用 `messages.createdAt` 索引 + `IDBKeyRange` 把扫描收窄到近 N 天；
 *   2. 逐条喂给领域累加器，只把聚合计数返回上层，不把整窗消息实体带进 React。
 *
 * 索引缺失时降级为整表扫描，但聚合仍在仓库内完成（记录不会离开本文件）。
 * 读取路径全部为 readonly 事务，不经过写队列、不产生任何写入。
 */

import {
  createActivityAccumulator,
  type ActivityMessageRecord,
  type ActivityScanResult,
} from "../../../domain/analytics/activityAggregation";
import { normalizeStoredMessageRole } from "../messageRecord";
import { getDB } from "../idbConnection";
import { bindReadonlyTransactionAbort } from "../idbQueue";

/** messages Store 的廉价版本信号：条数 + 最新消息时间戳。 */
export interface ActivityRevision {
  messageCount: number;
  /** 最新消息的 createdAt；索引缺失或库为空时为 0。 */
  latestCreatedAt: number;
}

interface RawMessageRecord {
  id?: unknown;
  sessionId?: unknown;
  role?: unknown;
  createdAt?: unknown;
  tokenCount?: unknown;
  generationTime?: unknown;
}

/** 只挑选聚合需要的字段，避免读取正文（V2 Content Parts 与派生文本都不需要）。 */
function toActivityMessageRecord(value: unknown): ActivityMessageRecord {
  const record = (value ?? {}) as RawMessageRecord;
  return {
    id: typeof record.id === "string" ? record.id : "",
    sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
    role: normalizeStoredMessageRole(record.role),
    timestamp: typeof record.createdAt === "number" ? record.createdAt : 0,
    tokenCount: typeof record.tokenCount === "number" ? record.tokenCount : undefined,
    generationTime: typeof record.generationTime === "number" ? record.generationTime : undefined,
  };
}

/**
 * 读取活动数据的版本信号。
 *
 * 只用两个 O(log n) 级请求（count + 索引末键），让上层可以在「没有新消息」时
 * 直接复用上一次聚合结果，避免流式渲染期间反复全量扫描。
 */
export async function readActivityRevision(): Promise<ActivityRevision> {
  const db = await getDB();
  return new Promise<ActivityRevision>((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const revision: ActivityRevision = { messageCount: 0, latestCreatedAt: 0 };
    let pending = 1;

    const settle = () => {
      pending -= 1;
      if (pending === 0) resolve(revision);
    };

    const countRequest = store.count();
    countRequest.onsuccess = () => {
      revision.messageCount = countRequest.result || 0;
      settle();
    };
    countRequest.onerror = () => reject(countRequest.error);

    if (store.indexNames.contains("createdAt")) {
      pending += 1;
      // 取索引最后一键即最新消息时间戳，不需要反序列化任何记录。
      const maxRequest = store.index("createdAt").openKeyCursor(null, "prev");
      maxRequest.onsuccess = () => {
        const cursor = maxRequest.result;
        if (cursor && typeof cursor.key === "number") revision.latestCreatedAt = cursor.key;
        settle();
      };
      maxRequest.onerror = () => reject(maxRequest.error);
    }

    bindReadonlyTransactionAbort(transaction, reject);
  });
}

/**
 * 扫描窗口内的消息并就地聚合。
 *
 * 有 `createdAt` 索引时以 `IDBKeyRange.lowerBound(windowStart)` 收窄；
 * 索引缺失（历史库未升级）时整表扫描，靠累加器丢弃窗口外记录保证口径一致。
 */
export async function scanActivityMessages(input: {
  windowStart: number;
  todayStart: number;
}): Promise<ActivityScanResult> {
  const accumulator = createActivityAccumulator(input);
  const db = await getDB();
  return new Promise<ActivityScanResult>((resolve, reject) => {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const hasCreatedAtIndex = store.indexNames.contains("createdAt");
    const source: IDBObjectStore | IDBIndex = hasCreatedAtIndex ? store.index("createdAt") : store;
    const range = hasCreatedAtIndex ? IDBKeyRange.lowerBound(input.windowStart) : undefined;

    const request = source.openCursor(range ?? null);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        accumulator.push(toActivityMessageRecord(cursor.value));
        cursor.continue();
        return;
      }
      resolve(accumulator.finish());
    };
    request.onerror = () => reject(request.error);
    bindReadonlyTransactionAbort(transaction, reject);
  });
}
