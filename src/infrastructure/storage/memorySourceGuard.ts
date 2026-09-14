/**
 * 记忆写入的来源消息校验（memory_fragments / memory_dict / memory_facts 共用）。
 *
 * 语义边界（两条路径必须区分对待）：
 *  1. **来源消息已不可用**（不存在 / 属其他会话）：这是删除级联与后台抽取之间的正常竞态
 *     —— 消息先被删除、抽取任务仍在跑。此时必须「跳过写入」而不是写入幽灵记忆，
 *     调用方也不应把它当失败处理。但它是**可观测**的：记录 warn 日志，绝不静默。
 *  2. **调用方未绑定任何来源**（`requireSourceMessages = true` 却传空列表）：语义自相矛盾，
 *     不可能是竞态，只能是调用方缺陷。此时显式 reject，避免把"数据未落库"伪装成成功。
 *
 * 历史实现把两条路径都处理成"既不写库也不 reject，事务照常 complete"，
 * 调用方一律拿到写入成功的假信号，记忆静默丢失且没有任何日志。
 *
 * 使用约束：调用方在 `transaction.oncomplete` 里 resolve 即可 —— 只有第 2 类会 reject，
 * 且该路径不产生任何写请求，不会出现"先 reject 又 resolve"的语义冲突。
 */

import { Logger } from "../../utils/logger";

const logger = Logger.create("memorySourceGuard");

export interface SourceMessageGuardParams {
  /** 被写入对象的标识，仅用于日志与错误信息。 */
  readonly ownerId: string;
  /** 被写入对象的类型标签（如 "Fragment" / "TemporalFact"），用于日志与错误信息。 */
  readonly ownerKind: string;
  /** 被写入对象所属会话。 */
  readonly sessionId: string;
  /** 要求必须存在且同会话的来源消息 ID 列表。 */
  readonly sourceMessageIds: readonly string[];
}

/**
 * 在既有 readwrite 事务内校验来源消息，校验通过时同步调用 `onValid`（由它执行真正的 put）。
 *
 * @param onValid 校验通过后的写入动作，只会被调用一次。
 * @param reject  事务 Promise 的 reject 句柄，仅用于「调用方未绑定来源」与「读取失败」。
 */
export function guardSourceMessages(
  transaction: IDBTransaction,
  params: SourceMessageGuardParams,
  onValid: () => void,
  reject: (error: unknown) => void,
): void {
  const ids = Array.isArray(params.sourceMessageIds) ? params.sourceMessageIds : [];
  if (ids.length === 0) {
    // 语义矛盾：要求校验来源却没给来源。这不可能来自删除竞态，属调用方缺陷，必须显式失败。
    logger.error("Memory write rejected: requireSourceMessages set but no source bound", undefined, {
      ownerKind: params.ownerKind,
      ownerId: params.ownerId,
      sessionId: params.sessionId,
    });
    reject(
      new Error(
        `[memory] ${params.ownerKind} ${params.ownerId} not written: requireSourceMessages set but sourceMessageIds is empty`,
      ),
    );
    return;
  }

  let settled = false;
  let pending = ids.length;

  const skip = (messageId: string, reason: string) => {
    if (settled) return;
    settled = true;
    // 正常竞态：消息已被删除/换会话，抽取任务仍在跑。跳过写入，但必须留痕。
    logger.warn("Memory write skipped: source message unavailable", {
      ownerKind: params.ownerKind,
      ownerId: params.ownerId,
      sessionId: params.sessionId,
      messageId,
      reason,
    });
  };

  for (const messageId of ids) {
    const request = transaction.objectStore("messages").get(messageId);
    request.onsuccess = () => {
      const source = request.result as { sessionId?: string } | undefined;
      if (!source) {
        skip(messageId, "message not found");
      } else if (source.sessionId !== params.sessionId) {
        skip(messageId, `message belongs to session ${source.sessionId ?? "unknown"}`);
      }
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        onValid();
      }
    };
    request.onerror = () => {
      // 读取失败是基础设施故障，不是校验结论：走 reject，避免调用方误判为"已跳过"。
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error(`[memory] failed to read source message ${messageId}`));
    };
  }
}
