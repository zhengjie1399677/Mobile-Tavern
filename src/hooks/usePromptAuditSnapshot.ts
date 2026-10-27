/**
 * 订阅「本轮 Prompt 审计快照」的只读 hook。
 *
 * 快照保存在 `promptAuditStore` 的模块级 Store 中（不进入 `UnifiedAppContext`），
 * 这里通过 `useSyncExternalStore` 桥接到 React，并按当前会话过滤，避免串话。
 */

import React from "react";
import type { PromptAuditSnapshot } from "../domain/promptAudit";
import {
  getPromptAuditSnapshot,
  subscribePromptAuditSnapshot,
} from "../application/services/prompt/promptAuditStore";

/**
 * @param sessionId 当前会话 id；传入时只返回属于该会话的快照，不匹配一律返回 null。
 */
export function usePromptAuditSnapshot(sessionId?: string | null): PromptAuditSnapshot | null {
  const snapshot = React.useSyncExternalStore(
    subscribePromptAuditSnapshot,
    getPromptAuditSnapshot,
    getPromptAuditSnapshot,
  );
  if (!snapshot) return null;
  if (sessionId && snapshot.sessionId !== sessionId) return null;
  return snapshot;
}
