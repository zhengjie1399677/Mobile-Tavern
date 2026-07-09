import React, { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import { ChatSession, Message, SummaryCard } from "../types";
import { globalKernel } from "../kernel/Kernel";
import { IDatabaseService, IMemoryService } from "../kernel/types";
import { useApp } from "./AppContext";

/**
 * 微内核插件式架构：会话 CRUD 走 DatabaseService，消息读取走 MemoryService。
 * 业务层不再直接触碰 localDB，遵循 AGENTS.md 准则一与准则八。
 */
function getDatabaseService(): IDatabaseService {
  return globalKernel.getService<IDatabaseService>("database");
}

function getMessagesBySession(
  sessionId: string,
  options?: { limit?: number; offset?: number; descending?: boolean }
): Promise<any[]> {
  return globalKernel.getService<IMemoryService>("memory").getStorage().getMessagesBySession(sessionId, options);
}

// P0-1: 启动时分页加载会话，避免一次性 getAll() 全量反序列化阻塞首屏。
// 默认每页 50 条（覆盖 95% 用户的会话总数），超出部分由 loadMoreSessions 滚动加载。
const SESSIONS_PAGE_SIZE = 50;

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
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
      const db = getDatabaseService();
      // P0-1: 启动时仅加载第一页（最近 SESSIONS_PAGE_SIZE 条会话），避免全量反序列化阻塞首屏。
      const total = await db.getSessionsCount();
      const firstPage = await db.getSessionsPaginated(1, SESSIONS_PAGE_SIZE);
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
      const more = await getDatabaseService().getSessionsPaginated(nextPage, SESSIONS_PAGE_SIZE);
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
  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session && (!session.messages || session.messages.length === 0)) {
      let isCurrent = true;
      getMessagesBySession(activeSessionId)
        .then((msgs) => {
          if (isCurrent) {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeSessionId
                  ? {
                      ...s,
                      messages: msgs.map((m: any) => ({
                        id: m.id,
                        sender: m.role === "user" ? "user" : "assistant",
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
  }, [activeSessionId, sessions]);

  const saveSession = async (session: ChatSession) => {
    try {
      await getDatabaseService().saveSession(session);
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

  const deleteSession = async (id: string) => {
    try {
      await getDatabaseService().deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
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
