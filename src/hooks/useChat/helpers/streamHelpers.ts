/**
 * streamHelpers.ts — 纯函数流式处理帮助工具
 *
 * 此文件严禁引入 globalKernel / tavernHelperBridge 等具有副作用的模块，
 * 以确保 Node.js 测试环境（不支持 Vite 的「?raw」语法）可安全 import 本文件。
 * 需要 Kernel Pipeline 的操作请使用 pipelineHelpers.ts（不经过 helpers barrel 导出）。
 */
import React from "react";
import { Message, ChatSession, UserSettings, CharacterCard, ReplyChoice } from "../../../types";
import type { OutputPipelineContext } from "../../../application/pipeline";
import { Logger } from "../../../utils/logger";

const logger = Logger.create("streamHelpers");
import { extractThinkContent, cleanSuggestionsFromText } from "./textParsing";
import { parseReplyChoices } from "./suggestions";

// ─── 唯一 ID 生成 ─────────────────────────────────────────────────────────────
export const generateUniqueId = (prefix: string): string =>
  prefix + Math.random().toString(36).substring(2, 9);

// ─── 节流更新器工厂 ────────────────────────────────────────────────────────────
/**
 * 缓冲型到达阈值（字符）。
 *
 * 单次到达增量达到该值，即判定上游是「整段缓冲后一次性下发」（大量第三方中转站）。
 * 此时若照旧立即显示，屏幕会从空白直接跳到全文，并一次性完成整段 Markdown 解析，
 * 表现为卡顿式喷出。达到阈值即进入分帧回放（纯显示层）。
 * 真流式的增量远小于该阈值，走原有即时路径，零额外延迟。
 */
export const BUFFERED_ARRIVAL_THRESHOLD_CHARS = 240;
/** 回放每拍间隔（与既有流式节流 60ms 一致，避免额外引入新的渲染节奏）。 */
export const REVEAL_TICK_MS = 60;
/** 每拍最少推进字符数，保证收尾阶段也能在少数几拍内结束。 */
export const REVEAL_MIN_STEP_CHARS = 40;
/** 每拍推进量 = max(下限, 积压 / 该值)：正文越长追得越快。 */
export const REVEAL_CATCHUP_DIVISOR = 6;
/** 单条回复回放总时长上限（毫秒）：超时直接补齐，避免长文播太久。 */
export const REVEAL_MAX_MS = 1200;

/** 返回一个节流 60ms 的内容更新函数，用于流式渲染中频控 setState。
 *
 * 性能优化要点（避免每次节流触发都做 O(sessions × messages) 双层 map 遍历）：
 *   1. 缓存 sessionIdx 和 msgIdx，下次校验 id 仍匹配则直接复用，命中为 O(1)
 *   2. 用 `arr.slice()` 浅拷贝 + 单点索引赋值替代 `arr.map(...)`，跳过闭包调用
 *   3. 仅在缓存失效时回退到 findIndex，避免每次都遍历整条 sessions/messages
 *   4. 缓冲型到达（单次增量 ≥ 阈值）走分帧回放：到达仍按原样累计（权威数据不变），
 *      只有"显示长度"按拍推进；取消、切换会话、最终提交都不受影响
 *
 * 缓存失效场景：sessions 被其他逻辑替换（如切换会话）、messages 被增删（如新消息插入）。
 * 此时缓存 id 校验不通过，自动回退到 findIndex 重新定位，安全无副作用。
 */
export function buildThrottledUpdater(
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  sessionId: string,
  aiMsgId: string,
  responseChunks: string[],
  reasoningChunks: string[],
  pendingUpdateTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
): {
  throttledUpdate: (content: string, reasoningContent?: string) => void;
  isStreamActiveRef: { current: boolean };
} {
  const isStreamActiveRef = { current: true };
  let lastUpdateTime = 0;
  let isFirstToken = true;
  // 索引缓存：跨多次节流 tick 复用，避免重复 findIndex
  let cachedSessionIdx = -1;
  let cachedMsgIdx = -1;

  const updateSessionsContent = (content: string, reasoningContent?: string) => {
    const parsed = extractThinkContent(content, reasoningContent, true);
    const cleaned = cleanSuggestionsFromText(parsed.content);
    setSessionViews((prev) => {
      // 定位 session：优先用缓存索引（校验 id 仍匹配），否则 findIndex
      let sIdx = cachedSessionIdx;
      if (sIdx < 0 || sIdx >= prev.length || prev[sIdx].id !== sessionId) {
        sIdx = prev.findIndex((s) => s.id === sessionId);
        if (sIdx < 0) return prev; // session 已不存在（被切换/删除），保留原 state
        cachedSessionIdx = sIdx;
      }
      const targetSession = prev[sIdx];

      // 定位 message：同样优先用缓存索引
      const msgs = targetSession.messages;
      let mIdx = cachedMsgIdx;
      if (mIdx < 0 || mIdx >= msgs.length || msgs[mIdx].id !== aiMsgId) {
        mIdx = msgs.findIndex((m) => m.id === aiMsgId);
        if (mIdx < 0) return prev; // 流式消息已被移除，保留原 state
        cachedMsgIdx = mIdx;
      }

      // 浅拷贝 + 单点替换：避免 map 闭包开销，V8 优化更友好
      const newMessages = msgs.slice();
      newMessages[mIdx] = {
        ...msgs[mIdx],
        content: cleaned.content,
        reasoningContent: parsed.reasoningContent,
      };
      const newSessions = prev.slice();
      newSessions[sIdx] = { ...targetSession, messages: newMessages };
      return newSessions;
    });
  };

  // ─── 分帧回放状态（纯显示层）────────────────────────────────────────────────
  // arrivedContentLength：上游已到达的权威正文长度（来自 responseChunks 累计）
  // revealedContentLength：已经画到屏幕上的正文长度（永远 ≤ 到达长度，不回退）
  // 说明：思考链不参与回放（可折叠块内、通常先于正文到达，整段显示不影响正文观感）
  let arrivedContentLength = 0;
  let revealedContentLength = 0;
  let revealActive = false;
  let revealStartedAt = 0;
  let latestContent = "";
  let latestReasoning: string | undefined;

  /** 每拍把显示长度向到达长度推进；推进量随积压自适应，并有总时长上限。 */
  const runRevealTick = () => {
    pendingUpdateTimeoutRef.current = null;
    if (!isStreamActiveRef.current) return;

    const backlog = latestContent.length - revealedContentLength;
    if (backlog <= 0) {
      revealActive = false;
      return;
    }

    const overBudget = performance.now() - revealStartedAt >= REVEAL_MAX_MS;
    const step = overBudget
      ? backlog
      : Math.max(REVEAL_MIN_STEP_CHARS, Math.ceil(backlog / REVEAL_CATCHUP_DIVISOR));
    revealedContentLength = Math.min(latestContent.length, revealedContentLength + step);
    updateSessionsContent(latestContent.slice(0, revealedContentLength), latestReasoning);

    if (revealedContentLength < latestContent.length) {
      pendingUpdateTimeoutRef.current = setTimeout(runRevealTick, REVEAL_TICK_MS);
    } else {
      revealActive = false;
    }
  };

  const scheduleRevealTick = (delayMs: number) => {
    pendingUpdateTimeoutRef.current = setTimeout(runRevealTick, delayMs);
  };

  const throttledUpdate = (content: string, reasoningContent?: string) => {
    if (!isStreamActiveRef.current) return;

    const arrivalDelta = content.length - arrivedContentLength;
    arrivedContentLength = content.length;
    latestContent = content;
    latestReasoning = reasoningContent;

    // 缓冲型到达：进入（或保持）分帧回放，不再整段即时显示
    if (arrivalDelta >= BUFFERED_ARRIVAL_THRESHOLD_CHARS && !revealActive) {
      revealActive = true;
      revealStartedAt = performance.now();
    }
    if (revealActive) {
      if (pendingUpdateTimeoutRef.current === null) scheduleRevealTick(REVEAL_TICK_MS);
      return;
    }

    // 即时路径（真流式）：显示长度与到达长度同步
    revealedContentLength = content.length;
    const now = performance.now();
    if (isFirstToken) {
      isFirstToken = false;
      lastUpdateTime = now;
      updateSessionsContent(content, reasoningContent);
      return;
    }
    if (now - lastUpdateTime >= 60) {
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      lastUpdateTime = now;
      updateSessionsContent(content, reasoningContent);
    } else if (!pendingUpdateTimeoutRef.current) {
      pendingUpdateTimeoutRef.current = setTimeout(() => {
        pendingUpdateTimeoutRef.current = null;
        if (!isStreamActiveRef.current || revealActive) return;
        lastUpdateTime = performance.now();
        updateSessionsContent(responseChunks.join(""), reasoningChunks.join(""));
      }, 60 - (now - lastUpdateTime));
    }
  };

  return { throttledUpdate, isStreamActiveRef };
}

// ─── 构建最终 AI 消息 ─────────────────────────────────────────────────────────
export function buildFinalAiMessage(params: {
  aiMsgId: string;
  responseText: string;
  reasoningText: string;
  startTime: number;
  tokenUsage: { prompt: number; completion: number };
  enableReplySuggestions: boolean;
  latestSession: ChatSession;
}): { finalAiMsg: Message; suggestions: string[]; replyChoices: ReplyChoice[] } {
  const { aiMsgId, responseText, reasoningText, startTime, tokenUsage, enableReplySuggestions, latestSession } = params;
  const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
  const cleaned = cleanSuggestionsFromText(parsed.content);
  let replyChoices: ReplyChoice[] = [];
  if (enableReplySuggestions && cleaned.suggestionsText) {
    replyChoices = parseReplyChoices(cleaned.suggestionsText);
  }
  const suggestions = replyChoices.map((choice) => choice.prompt);

  const finalAiMsg: Message = {
    id: aiMsgId,
    sender: "assistant",
    content: cleaned.content,
    timestamp: Date.now(),
    generationTime: (performance.now() - startTime) / 1000,
    tokenCount: tokenUsage.completion,
    promptTokenCount: tokenUsage.prompt,
    reasoningContent: parsed.reasoningContent || undefined,
    extra: {
      ...(latestSession.messages.find((m) => m.id === aiMsgId)?.extra || {}),
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      replyChoices: replyChoices.length > 0 ? replyChoices : undefined,
    },
  };

  return { finalAiMsg, suggestions, replyChoices };
}

// ─── 将最终消息替换 placeholder ──────────────────────────────────────────────
export function replacePlaceholderMessage(
  latestSession: ChatSession,
  finalAiMsg: Message
): ChatSession {
  const finalMessages = [...latestSession.messages];
  const idx = finalMessages.findIndex((m) => m.id === finalAiMsg.id);
  if (idx >= 0) {
    finalMessages[idx] = finalAiMsg;
  } else {
    finalMessages.push(finalAiMsg);
  }
  return { ...latestSession, messages: finalMessages };
}

// ─── 构建 OutputPipelineContext（无 globalKernel 依赖）────────────────────────
export function buildOutputContext(params: {
  session: ChatSession;
  responseText: string;
  reasoningText: string;
  settings: UserSettings;
  activeCharacter: CharacterCard;
  controller: AbortController;
  isStillActive: boolean;
  isBisonConsecutive: boolean;
  bisonRemainingCount: number;
}): OutputPipelineContext {
  return { ...params };
}

// ─── 试用次数校验 ─────────────────────────────────────────────────────────────
/** 读取当前免 Key 试用次数。 */
export const getTrialCount = (): number =>
  Number(localStorage.getItem("mobile_tavern_free_trial_count") || 0);

/** 增加免 Key 试用次数计数。 */
export const incrementTrialCount = (): void => {
  const count = getTrialCount();
  localStorage.setItem("mobile_tavern_free_trial_count", String(count + 1));
};

// ─── 记忆召回超时保护 ─────────────────────────────────────────────────────────
/**
 * 执行记忆召回并施加超时保护。
 *
 * 召回慢会阻塞 prompt 组装进而拖慢首字（TTFT）。超时后返回空数组（跳过召回），
 * 保证主链路不被慢召回卡死。后台 recall 仍会继续执行（IDB 查询无副作用），
 * 但其结果被丢弃。
 *
 * @param recallPromise 召回 Promise
 * @param timeoutMs 超时毫秒；undefined 走默认 3000ms，0 表示禁用超时（始终等待）
 * @param context 调用方标识，用于超时告警日志
 */
export async function recallWithTimeout(
  recallPromise: Promise<any[]>,
  timeoutMs: number | undefined,
  context: string
): Promise<any[]> {
  const timeout = timeoutMs ?? 3000;
  if (timeout <= 0) return recallPromise;
  return Promise.race([
    recallPromise,
    new Promise<any[]>((resolve) => {
      setTimeout(() => {
        logger.warn("记忆召回超时，跳过召回以保证首字响应", { context, timeout });
        resolve([]);
      }, timeout);
    }),
  ]);
}
