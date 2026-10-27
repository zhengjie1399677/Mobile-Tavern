/**
 * 本轮 Prompt 审计快照的瞬态存储。
 *
 * 审计结果只在当前进程内可见：它描述「刚刚那一次组装发生了什么」，
 * 既不属于会话数据，也不该扩进 `UnifiedAppContext`（该接口字段数已被守卫冻结）。
 * 因此这里用独立的最小 Store + `useSyncExternalStore` 消费，生产者是 `useChat`，
 * 消费方是聊天头部的「本轮提示词」面板。
 */

import type { PromptAuditSnapshot } from "../../../domain/promptAudit";

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: PromptAuditSnapshot | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** 发布最近一次组装结果；同一会话反复发送时直接覆盖上一条。 */
export function publishPromptAuditSnapshot(next: PromptAuditSnapshot): void {
  snapshot = next;
  emit();
}

/** 读取当前快照（SSR / 首帧由 React 直接调用的同步入口）。 */
export function getPromptAuditSnapshot(): PromptAuditSnapshot | null {
  return snapshot;
}

/** 订阅快照变化，返回取消订阅函数。 */
export function subscribePromptAuditSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 会话切换或会话被删除时清空，避免把上一个角色的命中结果当成当前会话的。
 * 快照本身带 `sessionId`，消费侧还会再校验一次，这里是第二道保险。
 */
export function resetPromptAuditSnapshot(): void {
  if (snapshot === null) return;
  snapshot = null;
  emit();
}
