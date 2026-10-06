/**
 * 聊天消息列表延迟渲染归属判定（2026-10-06 修复“切换会话整屏抖动”回归）。
 *
 * 背景：`DialogueHistoryView` 用 `useDeferredValue` 把流式期间每 60ms 一次的消息更新
 * 降级为低优先级提交（保证滚动/输入即时响应）。但切换会话后 deferred 值仍指向上一个
 * 会话的消息数组，若直接渲染会把上一会话整屏画进新会话，并让底部一次性定位与
 * `anchorTo: "end"` 按错误列表计算 —— 表现为切换瞬间的整屏抖动与错误滚动位置，
 * 带候选分支（swipes）的最新回复行更高时最后一跳更明显。
 */
import { describe, expect, it } from "vitest";
import type { Message } from "../../src/types";
import {
  resolveRenderedMessageList,
  type SessionMessageListPayload,
} from "../../src/tabs/chat/utils";

function message(id: string, content: string): Message {
  return { id, sender: "assistant", content, timestamp: 1 };
}

const sessionAMessages = [message("a1", "会话 A 的消息")];
const sessionBMessages = [message("b1", "会话 B 的消息")];

function payload(sessionId: string | null, messages: Message[]): SessionMessageListPayload {
  return { sessionId, messages };
}

describe("聊天消息列表延迟渲染归属判定", () => {
  it("同会话内使用延迟列表（保留降级渲染收益）", () => {
    const raw = payload("session-a", [message("a1", "流式新内容")]);
    const deferred = payload("session-a", sessionAMessages);

    expect(resolveRenderedMessageList(raw, deferred)).toBe(deferred.messages);
  });

  it("切换会话后立即使用原始列表，绝不渲染上一个会话的消息", () => {
    const raw = payload("session-b", sessionBMessages);
    const deferred = payload("session-a", sessionAMessages);

    const rendered = resolveRenderedMessageList(raw, deferred);
    expect(rendered).toBe(sessionBMessages);
    expect(rendered.some((m) => m.content.includes("会话 A"))).toBe(false);
  });

  it("延迟值追上后仍使用延迟列表（引用一致，不产生额外替换渲染）", () => {
    const raw = payload("session-b", sessionBMessages);
    const deferred = payload("session-b", sessionBMessages);

    expect(resolveRenderedMessageList(raw, deferred)).toBe(sessionBMessages);
  });
});
