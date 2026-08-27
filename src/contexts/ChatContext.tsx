import React, { createContext, useCallback, useContext, useState, useMemo, useEffect, useRef } from "react";
import {
  ChatMessageWindow,
  ChatMessageHydrationStatus,
  ChatSession,
  ChatSessionMetadata,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
  CharacterCard,
} from "../types";
import { useKernel } from "./KernelContext";
import { IDatabaseService } from "@/src/application/serviceContracts";
import {
  createChatSessionUseCases,
  mergeSessionPage,
} from "../application/useCases/chatSessionUseCases";
import { useApp } from "./AppContext";
import { TRANSLATIONS } from "../locales/index";
import type { MemoryServiceTyped } from "../application/services/memory";
import { prepareRuntimeProfileSessionResume } from "../application/useCases/runtimeProfileSessionResume";

import { getErrorMessage } from '../utils/errorUtils';
// P0-1: 启动时分页加载会话，避免一次性 getAll() 全量反序列化阻塞首屏。
// 默认每页 50 条（覆盖 95% 用户的会话总数），超出部分由 loadMoreSessions 滚动加载。
const SESSIONS_PAGE_SIZE = 50;

// 单会话消息分页懒加载页大小。
// 首次进入聊天室仅加载最新 50 条消息，用户滚动到顶部时通过 loadMoreMessages 异步追加更早的历史。
const MESSAGES_PAGE_SIZE = 50;

/** ChatProvider 在 LanguageProvider 上层，无法使用 useTranslation hook。此处直接从 TRANSLATIONS 读取当前语言的翻译。 */
function tChat(key: string, errorMessage: string): string {
  const lang = (typeof window !== "undefined" && localStorage.getItem("mobile_tavern_language")) || "zh-CN";
  const template = (TRANSLATIONS[lang]?.[key]) || TRANSLATIONS["zh-CN"]?.[key] || key;
  return template.replace("{error}", errorMessage);
}

interface ChatContextType {
  sessions: ChatSession[];
  setSessionViews: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  sessionCountsByCharacter: Readonly<Record<string, number>>;
  totalSessionCount: number;
  areSessionCountsReady: boolean;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  activeSession: ChatSession | null;
  isSending: boolean;
  setIsSending: (sending: boolean) => void;
  isSummarizing: boolean;
  setIsSummarizing: (summarizing: boolean) => void;
  availableModels: string[];
  setAvailableModels: (models: string[]) => void;
  isFetchingModels: boolean;
  setIsFetchingModels: (fetching: boolean) => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  loadSessions: () => Promise<void>;
  refreshSessionStatistics: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  updateSessionMetadata: (sessionId: string, patch: ChatSessionMetadataPatch) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  // 单会话消息分页懒加载
  hasMoreMessages: boolean;
  isLoadingMoreMessages: boolean;
  loadMoreMessages: () => Promise<void>;
  messageHydrationStatus: ChatMessageHydrationStatus;
  hydrateSessionMessages: (sessionId: string) => Promise<void>;
}

interface ConnectionStatus {
  testing: boolean;
  success?: boolean;
  message?: string;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

interface ChatStateStore {
  metadata: ChatSessionMetadata[];
  messageWindows: Record<string, ChatMessageWindow>;
}

function composeSessionViews(store: ChatStateStore): ChatSession[] {
  return store.metadata.map((metadata) => ({
    ...metadata,
    messages: store.messageWindows[metadata.id]?.messages ?? [],
  }));
}

function splitSessionViews(sessions: ChatSession[]): ChatStateStore {
  const metadata = sessions.map((session) => {
    const { messages: _messages, ...sessionMetadata } = session;
    return sessionMetadata;
  });
  const messageWindows = Object.fromEntries(sessions.map((session) => {
    return [session.id, {
      sessionId: session.id,
      messages: session.messages,
    } satisfies ChatMessageWindow];
  }));
  return { metadata, messageWindows };
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const kernel = useKernel();
  const dbService = kernel.getService<IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>>("database");
  const chatSessionUseCases = useMemo(
    () => createChatSessionUseCases(dbService),
    [dbService],
  );
  const { showCustomAlert } = useApp();
  const [chatStore, setChatStore] = useState<ChatStateStore>({ metadata: [], messageWindows: {} });
  const sessions = useMemo(() => composeSessionViews(chatStore), [chatStore]);
  const setSessionViews = useCallback<React.Dispatch<React.SetStateAction<ChatSession[]>>>((action) => {
    setChatStore((previous) => {
      const current = composeSessionViews(previous);
      const next = typeof action === "function" ? action(current) : action;
      return splitSessionViews(next);
    });
  }, []);
  const [sessionCountsByCharacter, setSessionCountsByCharacter] = useState<Record<string, number>>({});
  const [totalSessionCount, setTotalSessionCount] = useState(0);
  const [areSessionCountsReady, setAreSessionCountsReady] = useState(false);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ testing: false });

  // P0-1: 分页加载状态
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const loadedPageRef = useRef(0);
  const sessionCursorRef = useRef<{ createdAt: number; id: string } | undefined>(undefined);
  const totalCountRef = useRef(0);

  // 消息分页懒加载状态
  // hasMoreMessages / isLoadingMoreMessages 仅针对当前活跃会话；
  // 每个会话的累计已加载条数与是否还有更多历史缓存在 messagePagingRef 中，避免切换会话时重置。
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const messagePagingRef = useRef<Record<string, { oldestMessageId?: string; hasMore: boolean }>>({});
  const messageHydrationBySessionRef = useRef<Record<string, ChatMessageHydrationStatus>>({});
  const messageHydrationPromisesRef = useRef<Record<string, Promise<void>>>({});
  const [messageHydrationStatus, setMessageHydrationStatus] = useState<ChatMessageHydrationStatus>("idle");

  // sessions 快照 ref：供 useEffect 在不依赖 sessions 数组的前提下读取最新值
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const setActiveSessionId = useCallback((id: string | null): void => {
    const commitActiveSession = () => {
      setMessageHydrationStatus(
        id ? messageHydrationBySessionRef.current[id] ?? "idle" : "idle"
      );
      setHasMoreMessages(id ? messagePagingRef.current[id]?.hasMore ?? false : false);
      setActiveSessionIdState(id);
    };
    if (!id) {
      commitActiveSession();
      return;
    }
    const targetSession = sessionsRef.current.find((session) => session.id === id);
    if (!targetSession) {
      commitActiveSession();
      return;
    }
    const resume = prepareRuntimeProfileSessionResume(kernel, targetSession);
    if (resume.status === "ready") {
      commitActiveSession();
      return;
    }
    if (resume.status === "unavailable") {
      void showCustomAlert(resume.message);
      return;
    }
    window.location.reload();
  }, [kernel, showCustomAlert]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const loadSessions = async () => {
    try {
      // P0-1: 启动时仅加载第一页（最近 SESSIONS_PAGE_SIZE 条会话），避免全量反序列化阻塞首屏。
      const result = await chatSessionUseCases.loadInitialSessions(SESSIONS_PAGE_SIZE);
      if (isMountedRef.current) {
        setSessionViews(result.sessions);
        setSessionCountsByCharacter(result.countsByCharacter);
        setTotalSessionCount(result.total);
        setAreSessionCountsReady(true);
        loadedPageRef.current = 1;
        const lastSession = result.sessions.at(-1);
        sessionCursorRef.current = lastSession
          ? { createdAt: lastSession.createdAt, id: lastSession.id }
          : undefined;
        totalCountRef.current = result.total;
        setHasMoreSessions(result.hasMore);
      }
    } catch (e: unknown) {
      console.error("Failed to load sessions from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert(tChat("chat.load_sessions_failed", getErrorMessage(e)));
      }
    }
  };

  const loadMoreSessions = async () => {
    if (isLoadingMoreSessions || !hasMoreSessions) return;
    setIsLoadingMoreSessions(true);
    try {
      const result = await chatSessionUseCases.loadSessionPage(
        SESSIONS_PAGE_SIZE,
        sessionCursorRef.current,
      );
      if (isMountedRef.current) {
        setSessionViews((previous) => mergeSessionPage(previous, result.sessions));
        loadedPageRef.current += 1;
        const lastSession = result.sessions.at(-1);
        if (lastSession) {
          sessionCursorRef.current = { createdAt: lastSession.createdAt, id: lastSession.id };
        }
        setHasMoreSessions(result.hasMore);
      }
    } catch (e: unknown) {
      console.error("Failed to load more sessions from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert(tChat("chat.load_more_sessions_failed", getErrorMessage(e)));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingMoreSessions(false);
      }
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const refreshSessionStatistics = useCallback(async () => {
    try {
      const statistics = await chatSessionUseCases.loadSessionStatistics();
      if (!isMountedRef.current) return;
      setSessionCountsByCharacter(statistics.countsByCharacter);
      setTotalSessionCount(statistics.total);
      setAreSessionCountsReady(true);
      totalCountRef.current = statistics.total;
    } catch (error: unknown) {
      console.error("Failed to refresh session statistics:", error);
    }
  }, [chatSessionUseCases]);

  const setSessionHydrationStatus = useCallback((
    sessionId: string,
    status: ChatMessageHydrationStatus,
  ) => {
    messageHydrationBySessionRef.current[sessionId] = status;
    if (activeSessionIdRef.current === sessionId) {
      setMessageHydrationStatus(status);
    }
  }, []);

  const hydrateSessionMessages = useCallback((sessionId: string): Promise<void> => {
    const cachedPaging = messagePagingRef.current[sessionId];
    const cachedStatus = messageHydrationBySessionRef.current[sessionId];
    if (cachedPaging && cachedStatus === "ready") {
      return Promise.resolve();
    }

    const existingSession = sessionsRef.current.find((session) => session.id === sessionId);
    if (existingSession?.messages?.length) {
      messagePagingRef.current[sessionId] = cachedPaging ?? {
        oldestMessageId: existingSession.messages[0]?.id,
        hasMore: false,
      };
      setSessionHydrationStatus(sessionId, "ready");
      return Promise.resolve();
    }

    const inFlight = messageHydrationPromisesRef.current[sessionId];
    if (inFlight) return inFlight;

    setSessionHydrationStatus(sessionId, "loading");
    const hydrationPromise = chatSessionUseCases
      .loadMessagePage(sessionId, MESSAGES_PAGE_SIZE)
      .then((page) => {
        if (!isMountedRef.current) return;
        messagePagingRef.current[sessionId] = {
          oldestMessageId: page.messages[0]?.id,
          hasMore: page.hasMore,
        };
        setSessionViews((previous) => previous.map((session) =>
          session.id === sessionId
            ? { ...session, messages: page.messages }
            : session
        ));
        setSessionHydrationStatus(sessionId, "ready");
      })
      .catch((error: unknown) => {
        if (isMountedRef.current) {
          setSessionHydrationStatus(sessionId, "error");
        }
        throw error;
      })
      .finally(() => {
        delete messageHydrationPromisesRef.current[sessionId];
      });

    messageHydrationPromisesRef.current[sessionId] = hydrationPromise;
    return hydrationPromise;
  }, [chatSessionUseCases, setSessionHydrationStatus, setSessionViews]);

  // 监听活跃会话切换，异步懒加载其对应的 messages 并填充至 React State
  // 首次加载仅请求最新 MESSAGES_PAGE_SIZE 条消息，避免长会话全量反序列化阻塞首屏。
  useEffect(() => {
    if (!activeSessionId) {
      setMessageHydrationStatus("idle");
      return;
    }
    // 切换会话时，先从缓存恢复该会话的分页指示器状态
    const cached = messagePagingRef.current[activeSessionId];
    setHasMoreMessages(cached?.hasMore ?? false);
    const status = messageHydrationBySessionRef.current[activeSessionId] ?? "idle";
    setMessageHydrationStatus(status);
    if (status !== "error") {
      void hydrateSessionMessages(activeSessionId).catch((error: unknown) => {
        console.error("Failed to hydrate messages for active session:", error);
      });
    }
  }, [activeSessionId, hydrateSessionMessages]);

  useEffect(() => {
    if (!activeSessionId) return;
    const cached = messagePagingRef.current[activeSessionId];
    if (messageHydrationStatus === "ready") {
      setHasMoreMessages(cached?.hasMore ?? false);
    }
  }, [activeSessionId, messageHydrationStatus]);

  const updateSessionMetadata = async (sessionId: string, patch: ChatSessionMetadataPatch) => {
    try {
      await chatSessionUseCases.updateSessionMetadata(sessionId, patch);
      if (patch.pinnedMessageIds !== undefined || patch.mutedMessageIds !== undefined) {
        kernel.getService<MemoryServiceTyped>("memory").getRecall().invalidateCache(sessionId);
      }
      setSessionViews((prev) => prev.map((session) =>
        session.id === sessionId ? { ...session, ...patch } : session
      ));
    } catch (e: unknown) {
      console.error("Failed to save session to IndexedDB:", e);
      showCustomAlert(tChat("chat.save_session_failed", getErrorMessage(e)));
      throw e;
    }
  };

  // 加载更多历史消息。
  // 基于当前会话最早消息游标请求下一页，并 prepend 到 messages 数组前部。
  // 虚拟列表通过消息 key 与锚定策略保持当前视觉位置（见 DialogueHistoryView）。
  const loadMoreMessages = async () => {
    if (!activeSessionId || isLoadingMoreMessages || !hasMoreMessages) return;
    const cached = messagePagingRef.current[activeSessionId];
    if (!cached) return; // 尚未进行首次分页加载，忽略
    setIsLoadingMoreMessages(true);
    try {
      const page = await chatSessionUseCases.loadMessagePage(
        activeSessionId,
        MESSAGES_PAGE_SIZE,
        cached.oldestMessageId,
      );
      if (!isMountedRef.current) return;
      const loadedCount = page.loadedCount;
      const newHasMore = page.hasMore;
      messagePagingRef.current[activeSessionId] = {
        oldestMessageId: page.messages[0]?.id ?? cached.oldestMessageId,
        hasMore: newHasMore,
      };
      setHasMoreMessages(newHasMore);
      if (loadedCount > 0) {
        setSessionViews((prev) =>
          prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            // 每一页先转换为时间正序，再 prepend 到现有最新页之前。
            return {
              ...s,
              messages: [...page.messages, ...(s.messages || [])],
            };
          })
        );
      }
    } catch (e: unknown) {
      console.error("Failed to load more messages for active session:", e);
      if (isMountedRef.current) {
        showCustomAlert(tChat("chat.load_more_messages_failed", getErrorMessage(e)));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingMoreMessages(false);
      }
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await chatSessionUseCases.deleteSession(id);
      // 清理被删除会话的分页缓存，避免内存泄漏与幽灵状态
      delete messagePagingRef.current[id];
      delete messageHydrationBySessionRef.current[id];
      delete messageHydrationPromisesRef.current[id];
      setSessionViews((prev) => prev.filter((s) => s.id !== id));
      await refreshSessionStatistics();
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setHasMoreMessages(false);
      }
    } catch (e: unknown) {
      console.error("Failed to delete session from IndexedDB:", e);
      showCustomAlert(tChat("chat.delete_session_failed", getErrorMessage(e)));
      throw e;
    }
  };

  return (
    <ChatContext.Provider
      value={{
        sessions,
        setSessionViews,
        sessionCountsByCharacter,
        totalSessionCount,
        areSessionCountsReady,
        activeSessionId,
        setActiveSessionId,
        activeSession,
        isSending,
        setIsSending,
        isSummarizing,
        setIsSummarizing,
        availableModels,
        setAvailableModels,
        isFetchingModels,
        setIsFetchingModels,
        connectionStatus,
        setConnectionStatus,
        loadSessions,
        refreshSessionStatistics,
        loadMoreSessions,
        hasMoreSessions,
        isLoadingMoreSessions,
        updateSessionMetadata,
        deleteSession,
        // 消息分页懒加载
        hasMoreMessages,
        isLoadingMoreMessages,
        loadMoreMessages,
        messageHydrationStatus,
        hydrateSessionMessages,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChatState = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatState must be used within a ChatProvider");
  }
  return context;
};
