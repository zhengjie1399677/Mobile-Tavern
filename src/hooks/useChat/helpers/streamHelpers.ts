/**
 * streamHelpers.ts — 纯函数流式处理帮助工具
 *
 * 此文件严禁引入 globalKernel / tavernHelperBridge 等具有副作用的模块，
 * 以确保 Node.js 测试环境（不支持 Vite 的「?raw」语法）可安全 import 本文件。
 * 需要 Kernel Pipeline 的操作请使用 pipelineHelpers.ts（不经过 helpers barrel 导出）。
 */
import React from "react";
import { Message, ChatSession, UserSettings, CharacterCard } from "../../../types";
import { OutputPipelineContext } from "../../../kernel/types";
import { extractThinkContent, cleanSuggestionsFromText } from "./textParsing";
import { parseSuggestions } from "./suggestions";

// ─── 唯一 ID 生成 ─────────────────────────────────────────────────────────────
export const generateUniqueId = (prefix: string): string =>
  prefix + Math.random().toString(36).substring(2, 9);

// ─── 节流更新器工厂 ────────────────────────────────────────────────────────────
/** 返回一个节流 60ms 的内容更新函数，用于流式渲染中频控 setState。 */
export function buildThrottledUpdater(
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  sessionId: string,
  aiMsgId: string,
  responseChunks: string[],
  reasoningChunks: string[],
  pendingUpdateTimeoutRef: React.MutableRefObject<any>
): {
  throttledUpdate: (content: string, reasoningContent?: string) => void;
  isStreamActiveRef: { current: boolean };
} {
  const isStreamActiveRef = { current: true };
  let lastUpdateTime = 0;
  let isFirstToken = true;

  const updateSessionsContent = (content: string, reasoningContent?: string) => {
    const parsed = extractThinkContent(content, reasoningContent, true);
    const cleaned = cleanSuggestionsFromText(parsed.content);
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          messages: s.messages.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: cleaned.content, reasoningContent: parsed.reasoningContent }
              : m
          ),
        };
      })
    );
  };

  const throttledUpdate = (content: string, reasoningContent?: string) => {
    if (!isStreamActiveRef.current) return;
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
        if (!isStreamActiveRef.current) return;
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
}): { finalAiMsg: Message; suggestions: string[] } {
  const { aiMsgId, responseText, reasoningText, startTime, tokenUsage, enableReplySuggestions, latestSession } = params;
  const parsed = extractThinkContent(responseText.trim(), reasoningText.trim(), false);
  const cleaned = cleanSuggestionsFromText(parsed.content);
  let suggestions: string[] = [];
  if (enableReplySuggestions && cleaned.suggestionsText) {
    suggestions = parseSuggestions(cleaned.suggestionsText);
  }

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
    },
  };

  return { finalAiMsg, suggestions };
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
