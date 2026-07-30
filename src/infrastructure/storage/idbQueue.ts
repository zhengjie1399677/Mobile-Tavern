/**
 * IndexedDB 写队列与 AbortSignal 协作式中断传导。
 *
 * 从 localDB.ts 抽离，职责单一化：本模块只关心写操作的串行化、key 合并、
 * 超时熔断与 AbortSignal 传导，不涉及具体 CRUD 逻辑与 schema 管理。
 *
 * 设计要点：
 *  - 全局 writeQueue 串行化所有写事务，防止 WebView 环境下并发写冲突
 *  - 同 key 写操作合并（CoalescedSlot），仅保留最新 operation
 *  - AbortSignal 传导至底层 transaction.abort()，避免事务挂起死锁
 *  - 事务级 15s 超时熔断，防止单事务挂起阻塞整个队列
 *  - abortFn/abortedState 提升到 slot 级别，支持合并场景下第二次 signal 取消
 */

import { reportDbQueueTimeout } from "../../utils/telemetry";
import { Logger } from "../../utils/logger";

const logger = Logger.create("idbQueue");

// 全局基于 Promise 的队列，顺序串行化所有 IndexedDB 写入操作。
// 防止并发写入事务冲突或死锁，这在 WebView 原生环境中至关重要。
let writeQueue: Promise<any> = Promise.resolve();
let activeWriteQueueCount = 0;

// 写队列深度上限安全网：正常情况下由于 key 合并机制队列不会无限增长；阈值上报遥测告警用于诊断异常堆积。
const MAX_WRITE_QUEUE_DEPTH = 100;

// 按 key 合并待执行写槽位：当多个写操作针对同一 key 排队时，仅保留最新 operation 并共享同一 Promise。
// abortFn/abortedState 提升到 slot 级别：合并场景下第二次调用方的 signal 触发 abort 时，
// 需要能调用已注册的底层 transaction.abort() 并让正在 await getDB() 的 queuedOperation 提前退出。
interface CoalescedSlot<T> {
  operation: (ctx: WriteContext) => Promise<T>;
  pendingPromise: Promise<T> | null;
  abortFn: (() => void) | null;
  abortedState: boolean;
}
const pendingKeyedWrites = new Map<string, CoalescedSlot<any>>();

// 单次 IDB 写事务的超时阈值（15 秒）。
// 正常 IDB 写操作通常在 100ms 内完成，15 秒足以覆盖极端慢速设备与大批量写入场景，
// 同时防止事务挂起导致写队列永久阻塞（P0-2 修复）。
const WRITE_OPERATION_TIMEOUT_MS = 15000;

/**
 * 写操作取消上下文（AbortSignal 协作式中断传导）。
 *
 * 设计目的：解决 AbortSignal 仅作协作式中断、未透传至底层 IDB 事务的缺陷。
 * 当外部 signal 触发 abort 或写队列超时时，由 enqueueWrite 调用 registerAbort
 * 注册的句柄主动执行 transaction.abort()，真正释放底层 IDB 资源，避免事务挂起与死锁。
 *
 * 职责边界：
 *   - signal：外部取消信号（通常来自服务级 AbortController，如 DatabaseService.destroy）
 *   - registerAbort：operation 在创建 IDB 事务后注册 abort 句柄，供超时/取消时回调
 *   - aborted：是否已主动取消（超时或 signal abort）；为 true 时 onabort 不重复 reject
 */
export interface WriteContext {
  readonly signal?: AbortSignal;
  registerAbort(fn: () => void): void;
  readonly aborted: boolean;
}

/** 构造标准的 AbortError，兼容缺失 DOMException 的环境 */
function createAbortError(message = "The operation was aborted"): DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  // 兜底：极少数无 DOMException 的环境退化为普通 Error
  const err = new Error(message);
  (err as { name?: string }).name = "AbortError";
  return err as unknown as DOMException;
}

/**
 * 绑定 IDB 事务的主动 abort 句柄与 onabort 的 reject 行为。
 *
 * - 注册 abort 句柄到 ctx：当超时或外部 signal abort 时，由 enqueueWrite 回调
 *   `transaction.abort()` 真正释放底层 IDB 资源（核心修复：避免事务挂起死锁）。
 * - 设置 onabort：无论是否主动 abort 都 reject operation 的内部 Promise。
 *
 * onabort 无条件 reject 的原因（P0 修复）：
 *   旧实现主动 abort 时短路 return，依赖 race 的 signal/timeout 分支 reject。
 *   但合并写场景下第一调用方可能无 externalSignal，signalAbortPromise 永不 reject，
 *   导致 operation 内部 Promise 永不 settle，只能等 15s 超时。
 *   无条件 reject 后，race 仍取首个 settle 的结果，错误语义由 race 决定，
 *   不影响最终错误信息（Promise 一旦 settle 即免疫后续 reject）。
 *
 * 调用方在创建事务后立即调用本函数，替代原本手写的 `transaction.onabort = ...`。
 */
export function bindTransactionAbort(
  ctx: WriteContext,
  transaction: IDBTransaction,
  reject: (e: unknown) => void
): void {
  transaction.onabort = () => {
    // 无论是否主动 abort 都 reject：确保 operation 内部 Promise 一定 settle。
    // 主动 abort 时 transaction.error 可能为 null，用 AbortError 兜底；
    // 非主动 abort（QuotaExceededError 等）透传 transaction.error。
    reject(transaction.error || createAbortError());
  };
  ctx.registerAbort(() => {
    try { transaction.abort(); } catch { /* 事务可能已自行结束，忽略二次 abort */ }
  });
  // signal 可能在 operation 等待 getDB() 期间已触发，此时 abort 监听先于事务句柄注册。
  // registerAbort 会立即补调 transaction.abort()；同时结束本 operation 的内部 Promise，
  // 避免 Promise.race 已拒绝后遗留一个永久 pending 的无主任务。
  if (ctx.aborted) reject(createAbortError());
}

/**
 * 通用 readonly 事务 abort 兜底：事务被外部因素（QuotaExceededError、版本变更、
 * 浏览器回收等）中断时，调用方 Promise 必须被 reject，否则永久挂起。
 *
 * 仅用于 readonly 事务；readwrite 事务应使用 bindTransactionAbort 配合
 * AbortSignal 协作式中断。
 */
export function bindReadonlyTransactionAbort(
  transaction: IDBTransaction,
  reject: (e: unknown) => void
): void {
  transaction.onabort = () =>
    reject(transaction.error || new Error("Transaction aborted"));
}

export function enqueueWrite<T>(
  operation: (ctx: WriteContext) => Promise<T>,
  key?: string,
  externalSignal?: AbortSignal
): Promise<T> {
  // key 合并：若同一 key 的写操作已在队列中等待，用最新 operation 替换旧的并返回共享 Promise
  if (key) {
    const existing = pendingKeyedWrites.get(key);
    if (existing) {
      logger.warn("Write coalesced: previous pending operation replaced", { key });
      existing.operation = operation;
      // 第二次调用方的 externalSignal 必须能取消其收到的 Promise 并触发底层 abort。
      // 旧实现直接返回 existing.pendingPromise，signal2 被完全丢弃，调用方持有的
      // AbortController 形同虚设；DatabaseService.destroy() 发出 abort 后合并的写操作
      // 仍会执行，可能在服务已销毁后写入脏数据。
      if (!externalSignal) {
        return existing.pendingPromise as Promise<T>;
      }
      return new Promise<T>((resolve, reject) => {
        const onAbort2 = () => {
          // 标记 slot 已 abort：让正在 await getDB() 的 queuedOperation 在
          // registerAbort 时检测到 abortedState 并补调 transaction.abort()，
          // 同时阻止 operation 继续推进。
          existing.abortedState = true;
          // 若事务已创建（registerAbort 已注册 abortFn），立即触发底层 abort
          if (existing.abortFn) {
            try { existing.abortFn(); } catch { /* 事务可能已自行结束，忽略 */ }
          }
          reject(createAbortError());
        };
        if (externalSignal.aborted) {
          onAbort2();
          return;
        }
        externalSignal.addEventListener("abort", onAbort2, { once: true });
        existing.pendingPromise!.then(
          (v) => {
            externalSignal.removeEventListener("abort", onAbort2);
            resolve(v as T);
          },
          (e) => {
            externalSignal.removeEventListener("abort", onAbort2);
            reject(e);
          }
        );
      });
    }
  }

  const enqueueTime = Date.now();
  activeWriteQueueCount++;

  // 深度上限安全网 —— 超过阈值时上报遥测，但仍然入队保证数据完整性
  if (activeWriteQueueCount >= MAX_WRITE_QUEUE_DEPTH) {
    logger.error("Write queue depth exceeded safety threshold", undefined, {
      depth: activeWriteQueueCount,
      threshold: MAX_WRITE_QUEUE_DEPTH,
    });
    setTimeout(() => {
      try {
        reportDbQueueTimeout(0, activeWriteQueueCount);
      } catch (e) {
        logger.error("Failed to report queue overflow telemetry", e);
      }
    }, 0);
  }

  // 用可变 slot 包裹 operation，使得后续同 key 写入能替换 operation
  const slot: CoalescedSlot<T> = { operation, pendingPromise: null, abortFn: null, abortedState: false };
  if (key) {
    pendingKeyedWrites.set(key, slot);
  }

  const queuedOperation = async () => {
    activeWriteQueueCount--;
    const queueDelay = Date.now() - enqueueTime;
    if (queueDelay > 3000) {
      logger.warn("Write queue delay exceeded threshold", { queueDelayMs: queueDelay });
      setTimeout(() => {
        try {
          reportDbQueueTimeout(queueDelay, activeWriteQueueCount + 1);
        } catch (e) {
          logger.error("Failed to report queue timeout telemetry", e);
        }
      }, 0);
    }

    // 执行前从 pendingKeyedWrites 移除本 key，使执行期间新的同 key 写入可入队
    if (key) pendingKeyedWrites.delete(key);
    const latestOperation = slot.operation;

    // ── AbortSignal 协作式中断传导（DESIGN-NOTE）──────────────────────────
    // 1) 进入执行前 signal 已 abort 或合并场景下第二次 signal 已 abort：立即拒绝
    if (externalSignal?.aborted || slot.abortedState) {
      throw createAbortError();
    }

    // abortFn/abortedState 提升到 slot：合并场景下第二次调用方的 signal 触发 abort 时
    // 需要能调用已注册的底层 transaction.abort()，并让 registerAbort 检测到 abortedState。
    const ctx: WriteContext = {
      signal: externalSignal,
      get aborted() { return slot.abortedState; },
      registerAbort(fn) {
        slot.abortFn = fn;
        // 处理“signal 已触发、事务稍后才创建”的注册竞态。若不补调，调用方虽然
        // 已收到 AbortError，底层 IDB 事务仍会继续运行且超时计时器已在 finally 清除。
        if (slot.abortedState) fn();
      },
    };

    // signal abort 监听：触发时主动 abort 底层事务并 reject
    let signalReject!: (e: unknown) => void;
    const signalAbortPromise = new Promise<never>((_, reject) => {
      signalReject = reject;
    });
    const onAbort = () => {
      slot.abortedState = true;
      if (slot.abortFn) {
        try { slot.abortFn(); } catch { /* 事务可能已自行结束，忽略 */ }
      }
      signalReject(createAbortError());
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onAbort);
    }

    // 事务级超时保护：防止单个 IDB 事务挂起导致整个写队列永久阻塞。
    // 超时后主动调用 transaction.abort() 释放底层资源（核心修复），再 reject。
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        slot.abortedState = true;
        if (slot.abortFn) {
          try { slot.abortFn(); } catch { /* 事务可能已自行结束，忽略 */ }
        }
        reject(new Error(`[localDB] Write operation timed out after ${WRITE_OPERATION_TIMEOUT_MS}ms`));
      }, WRITE_OPERATION_TIMEOUT_MS);
    });

    try {
      // 三路 race：operation 成功 / 超时 / signal abort
      // 主动 abort 时 operation 的 onabort 不重复 reject（由 ctx.aborted 短路）
      return await Promise.race([latestOperation(ctx), timeoutPromise, signalAbortPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    }
  };

  const result = writeQueue.then(queuedOperation);
  // 链接下一个任务，捕获所有异常确保后续队列操作正常运行
  writeQueue = result.then(
    () => {},
    () => {}
  );
  slot.pendingPromise = result;
  return result;
}

/**
 * 测试专用：重置写队列状态。
 * 供 localDB.__resetDBInstanceForTesting 协调调用，严禁生产代码使用。
 */
export function __resetWriteQueueForTesting(): void {
  writeQueue = Promise.resolve();
  activeWriteQueueCount = 0;
  pendingKeyedWrites.clear();
}
