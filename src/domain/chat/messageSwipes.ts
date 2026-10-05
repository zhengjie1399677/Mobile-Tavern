import type { Message } from "../../types";

/**
 * 末尾消息候选分支（Message Swipes）的领域规则。
 *
 * 只维护当前会话最新一条 AI 回复的候选版本：容量上限、先进先出淘汰、推理内容与候选
 * 下标对齐，全部收口在这里，避免"重掷生成"、"候选翻页"、"下一轮固化"三条路径各自
 * 维护一份隐式约定（历史上它们确实漂移过）。
 */

/** 候选版本容量上限：超出后淘汰最老的一条。 */
export const MAX_SWIPE_CANDIDATES = 5;

export interface SwipeCandidateSource {
  content?: string;
  reasoningContent?: string;
  swipes?: readonly string[];
  swipe_id?: number;
  swipeIndex?: number;
  swipeReasonings?: readonly string[];
}

export interface SwipeCandidateSet {
  swipes: string[];
  reasonings: string[];
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return total - 1;
  return Math.max(0, Math.min(total - 1, Math.trunc(index)));
}

/**
 * 读取一条消息当前已有的候选集合。
 *
 * 兼容三类历史数据：
 * 1. 从未重掷过（无 `swipes`）：以当前正文+推理作为唯一候选；
 * 2. 有 `swipes` 但缺少逐条推理（本次修复前的持久化记录）：只把当前激活项的
 *    `reasoningContent` 归位到对应下标，其余留空，绝不把当前推理错记到别的版本上；
 * 3. 完整记录：逐条沿用。
 */
export function readSwipeCandidates(message: SwipeCandidateSource): SwipeCandidateSet {
  const content = typeof message.content === "string" ? message.content : "";
  const swipes = Array.isArray(message.swipes) && message.swipes.length > 0
    ? [...message.swipes]
    : content
      ? [content]
      : [];
  if (swipes.length === 0) return { swipes: [], reasonings: [] };

  const stored = Array.isArray(message.swipeReasonings) ? [...message.swipeReasonings] : [];
  const activeIndex = clampIndex(
    typeof message.swipeIndex === "number"
      ? message.swipeIndex
      : typeof message.swipe_id === "number"
        ? message.swipe_id
        : swipes.length - 1,
    swipes.length,
  );
  const activeReasoning = typeof message.reasoningContent === "string" ? message.reasoningContent : "";

  return {
    swipes,
    reasonings: swipes.map((_, index) => stored[index] ?? (index === activeIndex ? activeReasoning : "")),
  };
}

/** 追加一条新生成候选；超出容量时按先进先出淘汰最老版本。 */
export function appendSwipeCandidate(
  existing: SwipeCandidateSet,
  content: string,
  reasoning: string,
): SwipeCandidateSet & { index: number } {
  const swipes = [...existing.swipes];
  const reasonings = existing.swipes.map((_, index) => existing.reasonings[index] ?? "");

  if (swipes.length >= MAX_SWIPE_CANDIDATES) {
    swipes.shift();
    reasonings.shift();
  }
  swipes.push(content);
  reasonings.push(reasoning);
  return { swipes, reasonings, index: swipes.length - 1 };
}

/**
 * 固化候选分支：只保留当前激活的正文与推理，清除临时候选字段，释放内存与存储。
 *
 * 调用方必须保证 `message.content` / `message.reasoningContent` 已经是激活版本
 * （候选翻页与重掷生成都会同步写回这两个字段）。
 */
export function stripSwipeCandidates<T extends SwipeCandidateSource>(
  message: T,
): Omit<T, "swipes" | "swipe_id" | "swipeIndex" | "swipeReasonings"> {
  const {
    swipes: _swipes,
    swipe_id: _swipeId,
    swipeIndex: _swipeIndex,
    swipeReasonings: _swipeReasonings,
    ...solidified
  } = message;
  return solidified;
}

/** 判断消息是否携带候选分支（正文之外的临时版本）。 */
export function hasSwipeCandidates(message: Pick<Message, "swipes" | "swipeIndex">): boolean {
  return Boolean(message.swipes && message.swipes.length > 0) || message.swipeIndex !== undefined;
}
