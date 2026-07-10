/**
 * 小猫助手雪团的全局单例状态与定时器管理
 *
 * 从 useCatbot.ts 抽离的全局状态层，防止页面组件切换卸载时状态和聊天历史丢失。
 * 包含：
 *   - 全局状态 globalState（expression/messages/bubbleText/showBubble/isLoading）
 *   - 监听器集合 listeners 与更新广播 updateGlobalState
 *   - 气泡/表情定时器 bubbleTimer/expressionTimer 与清理函数
 *   - 会话起始时间戳 catbotSessionStart（用于诊断上下文上报）
 */

export type CatExpression = "idle" | "thinking" | "relax" | "sleepy" | "sleep";

export interface CatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface CatbotGlobalState {
  expression: CatExpression;
  messages: CatMessage[];
  bubbleText: string;
  showBubble: boolean;
  isLoading: boolean;
}

// 全局单例状态（防止组件卸载时状态丢失）
export let globalState: CatbotGlobalState = {
  expression: "idle",
  messages: [
    {
      id: "welcome",
      role: "assistant",
      content: "喵呜~ 我是一只住在你手机里、专门帮你管酒馆的小懒猫雪团喵！🐾 长按本喵可以快捷打开/收起这个大面板。如果遇到什么配置问题，或者单纯想摸摸本喵闲聊，随时在这里打字告诉我喵！✨",
      timestamp: Date.now(),
    },
  ],
  bubbleText: "",
  showBubble: false,
  isLoading: false,
};

const listeners = new Set<() => void>();

export function updateGlobalState(updates: Partial<CatbotGlobalState>) {
  globalState = { ...globalState, ...updates };
  listeners.forEach((listener) => listener());
}

export function subscribeGlobalState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 模块级定时器句柄（气泡/表情恢复）
export let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
export let expressionTimer: ReturnType<typeof setTimeout> | null = null;

export function setBubbleTimer(timer: ReturnType<typeof setTimeout> | null): void {
  bubbleTimer = timer;
}

export function setExpressionTimer(timer: ReturnType<typeof setTimeout> | null): void {
  expressionTimer = timer;
}

export function clearTimers(): void {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (expressionTimer) clearTimeout(expressionTimer);
}

// 会话起始时间戳，用于诊断上下文上报
export const catbotSessionStart = Date.now();
