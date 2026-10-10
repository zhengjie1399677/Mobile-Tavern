// 纯函数工具与文件级全局可变状态
// 从原 ChatTab.tsx 中抽离，供子模块共享

import type { Message } from "../../types";

export const isSafeRegex = (pattern: string): boolean => {
  if (!pattern) return true;
  return !/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(pattern) && !/(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(pattern);
};

/** 消息列表载荷：把所属会话 id 与列表打包，供延迟渲染判定"这份列表属于谁"。 */
export interface SessionMessageListPayload {
  sessionId: string | null;
  messages: Message[];
}

/**
 * 选择本次真正渲染的消息列表。
 *
 * `useDeferredValue` 只允许在同一会话内延后（流式期间每 60ms 一次的消息更新降级为
 * 低优先级提交，保证滚动与输入即时响应）。但延迟值**跨会话并不安全**：切换会话后
 * `deferred` 仍指向上一个会话的消息数组，直接渲染等于把上一会话整屏画进新会话，
 * 并且底部锚定/一次性定位会按错误列表计算，表现为切换瞬间的整屏抖动与错误滚动位置。
 * 因此按会话 id 判定：只有同会话才使用延迟值。
 */
export function resolveRenderedMessageList(
  raw: SessionMessageListPayload,
  deferred: SessionMessageListPayload,
): Message[] {
  return deferred.sessionId === raw.sessionId ? deferred.messages : raw.messages;
}

// 消息列表"贴底"判定阈值（px）：滚动引擎、虚拟列表与输入区高度补偿共用同一口径，
// 避免三处各自硬编码导致"是否贴着底部"的判断漂移。
export const CHAT_SCROLL_BOTTOM_THRESHOLD = 60;

// 文件级全局可变状态容器，抗御任何组件的销毁重装，确保基准永不丢失
// 使用对象封装以便跨模块读写（ES Module 的 let 导出无法被外部赋值）
export const chatTabState = {
  // 建议词点击模式：send=直接发送 / fill=填入框内
  suggestionsClickMode: null as "send" | "fill" | null,
};
