import React, { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import { ChatSession, Message, SummaryCard } from "../types";
import { useKernel } from "./KernelContext";
import { IDatabaseService, IMemoryService } from "../kernel/types";
import { useApp } from "./AppContext";

// P0-1: 启动时分页加载会话，避免一次性 getAll() 全量反序列化阻塞首屏。
// 默认每页 50 条（覆盖 95% 用户的会话总数），超出部分由 loadMoreSessions 滚动加载。
const SESSIONS_PAGE_SIZE = 50;

// TODO-4: 单会话消息分页懒加载页大小。
// 首次进入聊天室仅加载最新 50 条消息，用户滚动到顶部时通过 loadMoreMessages 异步追加更早的历史。
const MESSAGES_PAGE_SIZE = 50;

interface ChatContextType {
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
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
  connectionStatus: { testing: boolean; success?: boolean; message?: string };
  setConnectionStatus: (status: any) => void;
  loadSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  saveSession: (session: ChatSession) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  // TODO-4: 消息分页懒加载
  hasMoreMessages: boolean;
  isLoadingMoreMessages: boolean;
  loadMoreMessages: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const kernel = useKernel();
  const dbService = kernel.getService<IDatabaseService>("database");
  const memoryService = kernel.getService<IMemoryService>("memory");
  const { showCustomAlert } = useApp();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<any>({ testing: false });

  // P0-1: 分页加载状态
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [isLoadingMoreSessions, setIsLoadingMoreSessions] = useState(false);
  const loadedPageRef = useRef(0);
  const totalCountRef = useRef(0);

  // TODO-4: 消息分页懒加载状态
  // hasMoreMessages / isLoadingMoreMessages 仅针对当前活跃会话；
  // 每个会话的累计已加载条数与是否还有更多历史缓存在 messagePagingRef 中，避免切换会话时重置。
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const messagePagingRef = useRef<Record<string, { offset: number; hasMore: boolean }>>({});

  // sessions 快照 ref：供 useEffect 在不依赖 sessions 数组的前提下读取最新值
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;

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
      const total = await dbService.getSessionsCount();
      const firstPage = await dbService.getSessionsPaginated(1, SESSIONS_PAGE_SIZE);
      if (isMountedRef.current) {
        setSessions(firstPage || []);
        loadedPageRef.current = 1;
        totalCountRef.current = total;
        setHasMoreSessions(total > (firstPage?.length || 0));
      }
    } catch (e: any) {
      console.error("Failed to load sessions from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert("加载聊天记录失败: " + e.message);
      }
    }
  };

  const loadMoreSessions = async () => {
    if (isLoadingMoreSessions || !hasMoreSessions) return;
    setIsLoadingMoreSessions(true);
    try {
      const nextPage = loadedPageRef.current + 1;
      const more = await dbService.getSessionsPaginated(nextPage, SESSIONS_PAGE_SIZE);
      const moreLength = more?.length || 0;
      if (isMountedRef.current) {
        setSessions((prev) => {
          // 去重合并：用户在加载期间可能已新建会话，避免重复
          const existing = new Set(prev.map((s) => s.id));
          const merged = [...prev];
          for (const s of more || []) {
            if (!existing.has(s.id)) {
              merged.push(s);
              existing.add(s.id);
            }
          }
          return merged;
        });
        loadedPageRef.current = nextPage;
        // 若本页返回少于 pageSize，说明已无更多
        setHasMoreSessions(moreLength >= SESSIONS_PAGE_SIZE);
      }
    } catch (e: any) {
      console.error("Failed to load more sessions from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert("加载更多聊天记录失败: " + e.message);
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

  // 监听活跃会话切换，异步懒加载其对应的 messages 并填充至 React State
  // TODO-4: 首次加载仅请求最新 MESSAGES_PAGE_SIZE 条消息，避免长会话全量反序列化阻塞首屏。
  useEffect(() => {
    if (!activeSessionId) return;
    // 切换会话时，先从缓存恢复该会话的分页指示器状态
    const cached = messagePagingRef.current[activeSessionId];
    if (cached) {
      setHasMoreMessages(cached.hasMore);
    } else {
      setHasMoreMessages(false);
    }

    const session = sessionsRef.current.find((s) => s.id === activeSessionId);
    // 仅在会话尚无内存消息且分页缓存也未建立时执行首次分页加载；
    // 已加载过（含切回）的会话沿用其已有 messages，避免重复请求与视觉跳动。
    const alreadyPaged = !!cached;
    if (session && (!session.messages || session.messages.length === 0) && !alreadyPaged) {
      let isCurrent = true;
      // descending: true → 取最新 N 条（内部最终 reverse 为升序返回）
      memoryService.getStorage().getMessagesBySession(activeSessionId, {
        limit: MESSAGES_PAGE_SIZE,
        descending: true,
      })
        .then((msgs) => {
          if (isCurrent && isMountedRef.current) {
            const loaded = msgs.length;
            const hasMore = loaded >= MESSAGES_PAGE_SIZE;
            messagePagingRef.current[activeSessionId] = { offset: loaded, hasMore };
            setHasMoreMessages(hasMore);
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeSessionId
                  ? {
                      ...s,
                      messages: msgs.map((m: any) => ({
                        id: m.id,
                        sender: m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant",
                        content: m.content,
                        timestamp: m.createdAt,
                        extra: m.metadata,
                      })),
                    }
                  : s
              )
            );
          }
        })
        .catch((err) => {
          console.error("Failed to lazy load messages for active session:", err);
        });

      return () => {
        isCurrent = false;
      };
    }
  }, [activeSessionId, memoryService]);

  const saveSession = async (session: ChatSession) => {
    try {
      await dbService.saveSession(session);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === session.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = session;
          return next;
        }
        return [...prev, session];
      });
    } catch (e: any) {
      console.error("Failed to save session to IndexedDB:", e);
      showCustomAlert("保存聊天记录失败: " + e.message);
      throw e;
    }
  };

  // TODO-4: 加载更多历史消息。
  // 基于当前会话已加载的 offset，请求下一页（更早的）消息，并 prepend 到 messages 数组前部。
  // 调用方需在加载完成后自行调整滚动位置以保持视觉锚点（见 useChatScroll / DialogueHistoryView）。
  const loadMoreMessages = async () => {
    if (!activeSessionId || isLoadingMoreMessages || !hasMoreMessages) return;
    const cached = messagePagingRef.current[activeSessionId];
    if (!cached) return; // 尚未进行首次分页加载，忽略
    setIsLoadingMoreMessages(true);
    try {
      const olderMsgs = await memoryService
        .getStorage()
        .getMessagesBySession(activeSessionId, {
          limit: MESSAGES_PAGE_SIZE,
          offset: cached.offset,
          descending: true,
        });
      if (!isMountedRef.current) return;
      const loadedCount = olderMsgs.length;
      const newHasMore = loadedCount >= MESSAGES_PAGE_SIZE;
      const newOffset = cached.offset + loadedCount;
      messagePagingRef.current[activeSessionId] = { offset: newOffset, hasMore: newHasMore };
      setHasMoreMessages(newHasMore);
      if (loadedCount > 0) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            const mapped = olderMsgs.map((m: any) => ({
              id: m.id,
              sender: m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant",
              content: m.content,
              timestamp: m.createdAt,
              extra: m.metadata,
            }));
            // descending: true 时返回的批次内部已按时间升序排列（函数末尾 reverse 过），
            // 因此直接 prepend 到已有 messages 之前即可保持整体时间升序。
            return {
              ...s,
              messages: [...mapped, ...(s.messages || [])],
            };
          })
        );
      }
    } catch (e: any) {
      console.error("Failed to load more messages for active session:", e);
      if (isMountedRef.current) {
        showCustomAlert("加载更早的消息失败: " + e.message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingMoreMessages(false);
      }
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await dbService.deleteSession(id);
      // TODO-4: 清理被删除会话的分页缓存，避免内存泄漏与幽灵状态
      delete messagePagingRef.current[id];
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setHasMoreMessages(false);
      }
    } catch (e: any) {
      console.error("Failed to delete session from IndexedDB:", e);
      showCustomAlert("删除聊天记录失败: " + e.message);
      throw e;
    }
  };

  return (
    <ChatContext.Provider
      value={{
        sessions,
        setSessions,
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
        loadMoreSessions,
        hasMoreSessions,
        isLoadingMoreSessions,
        saveSession,
        deleteSession,
        // TODO-4: 消息分页懒加载
        hasMoreMessages,
        isLoadingMoreMessages,
        loadMoreMessages,
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
