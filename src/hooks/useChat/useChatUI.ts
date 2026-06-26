import React, { useState, useEffect, useCallback } from "react";

export interface ChatUIState {
  // 显示控制
  showSessionManager: boolean;
  setShowSessionManager: React.Dispatch<React.SetStateAction<boolean>>;
  showFullHistory: boolean;
  setShowFullHistory: React.Dispatch<React.SetStateAction<boolean>>;
  chatSubTab: "dialogue" | "timeline";
  setChatSubTab: React.Dispatch<React.SetStateAction<"dialogue" | "timeline">>;

  // 输入消息 & 草稿
  userInputMessage: string;
  setUserInputMessage: React.Dispatch<React.SetStateAction<string>>;
  draftsRef: React.MutableRefObject<Record<string, string>>;
  userInputMessageRef: React.MutableRefObject<string>;

  // 回复建议
  replySuggestions: string[];
  setReplySuggestions: React.Dispatch<React.SetStateAction<string[]>>;

  // 编辑消息态
  editingMsgId: string | null;
  setEditingMsgId: React.Dispatch<React.SetStateAction<string | null>>;
  editingMsgContent: string;
  setEditingMsgContent: React.Dispatch<React.SetStateAction<string>>;

  // 消息菜单
  msgMenuId: string | null;
  setMsgMenuId: React.Dispatch<React.SetStateAction<string | null>>;

  // Bison 模式锁
  isBisonLocking: boolean;
  setIsBisonLocking: React.Dispatch<React.SetStateAction<boolean>>;
  bisonRemainingCountRef: React.MutableRefObject<number>;
  // P1-8: Bison 连续推进 setTimeout 的 timer id，供会话切换/卸载/手动停止时清理
  bisonChainTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;

  // 流控 refs
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  isSendingRef: React.MutableRefObject<boolean>;
  activeRequestIdRef: React.MutableRefObject<number>;
  pendingUpdateTimeoutRef: React.MutableRefObject<any>;

  // 滚动
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
}

/**
 * 管理聊天界面 UI 状态、输入草稿、Bison 锁和滚动触发，
 * 不包含任何 API 调用或数据库操作。
 */
export function useChatUI(params: {
  activeSessionId: string | null;
  activeSession: { messages: any[] } | null;
  setIsSending: (v: boolean) => void;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
}): ChatUIState {
  const { activeSessionId, activeSession, setIsSending, chatBottomRef } = params;

  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [chatSubTab, setChatSubTab] = useState<"dialogue" | "timeline">("dialogue");

  useEffect(() => {
    setShowFullHistory(false);
  }, [activeSessionId]);

  const [replySuggestions, setReplySuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (activeSession && activeSession.messages.length > 0) {
      const lastMsg = activeSession.messages[activeSession.messages.length - 1];
      if (lastMsg.sender === "assistant" && lastMsg.extra?.suggestions) {
        setReplySuggestions(lastMsg.extra.suggestions);
      } else {
        setReplySuggestions([]);
      }
    } else {
      setReplySuggestions([]);
    }
  }, [activeSessionId, activeSession]);

  const [userInputMessage, setUserInputMessage] = useState("");
  const draftsRef = React.useRef<Record<string, string>>({});
  const userInputMessageRef = React.useRef(userInputMessage);
  useEffect(() => {
    userInputMessageRef.current = userInputMessage;
  }, [userInputMessage]);

  const prevSessionIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current;
    const currentSessionId = activeSessionId;
    if (prevSessionId && prevSessionId !== currentSessionId) {
      draftsRef.current[prevSessionId] = userInputMessageRef.current;
    }
    if (currentSessionId) {
      setUserInputMessage(draftsRef.current[currentSessionId] || "");
    } else {
      setUserInputMessage("");
    }
    prevSessionIdRef.current = currentSessionId;
  }, [activeSessionId]);

  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");
  const [msgMenuId, setMsgMenuId] = useState<string | null>(null);

  const [isBisonLocking, setIsBisonLocking] = useState(false);
  const bisonRemainingCountRef = React.useRef<number>(0);
  // P1-8: Bison 连续推进 setTimeout 的 timer id，供会话切换/卸载/手动停止时清理
  const bisonChainTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const abortControllerRef = React.useRef<AbortController | null>(null);
  const isSendingRef = React.useRef(false);
  const activeRequestIdRef = React.useRef(0);
  const pendingUpdateTimeoutRef = React.useRef<any>(null);

  // 卸载时清理
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        isSendingRef.current = false;
        setIsSending(false);
      }
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
      // P1-8: 卸载时清理 Bison 链 timer，避免对已卸载组件 state 进行更新
      if (bisonChainTimerRef.current) {
        clearTimeout(bisonChainTimerRef.current);
        bisonChainTimerRef.current = null;
      }
    };
  }, [setIsSending]);

  const triggerScroll = useCallback(
    (behavior: "smooth" | "instant" | "auto" = "smooth") => {
      setTimeout(() => {
        if (chatBottomRef && chatBottomRef.current) {
          const container = chatBottomRef.current.parentElement;
          if (container) {
            if (behavior === "smooth") {
              container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
            } else {
              container.scrollTop = container.scrollHeight;
              const _unused = container.offsetHeight;
              requestAnimationFrame(() => {
                if (container.scrollTop > 0) {
                  container.scrollTop += 0.5;
                  container.scrollTop -= 0.5;
                }
              });
            }
          } else {
            chatBottomRef.current.scrollIntoView({ behavior });
          }
        }
      }, 100);
    },
    [chatBottomRef]
  );

  return {
    showSessionManager, setShowSessionManager,
    showFullHistory, setShowFullHistory,
    chatSubTab, setChatSubTab,
    userInputMessage, setUserInputMessage,
    draftsRef, userInputMessageRef,
    replySuggestions, setReplySuggestions,
    editingMsgId, setEditingMsgId,
    editingMsgContent, setEditingMsgContent,
    msgMenuId, setMsgMenuId,
    isBisonLocking, setIsBisonLocking,
    bisonRemainingCountRef, bisonChainTimerRef,
    abortControllerRef, isSendingRef, activeRequestIdRef, pendingUpdateTimeoutRef,
    triggerScroll,
  };
}
