import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { ChatSession, Message, SummaryCard } from "../types";
import { getAllSessions, saveSession as dbSaveSession, deleteSession as dbDeleteSession } from "../utils/localDB";
import { useApp } from "./AppContext";

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

  const isMountedRef = React.useRef(true);
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
      const stored = await getAllSessions();
      if (isMountedRef.current) {
        setSessions(stored || []);
      }
    } catch (e: any) {
      console.error("Failed to load sessions from IndexedDB:", e);
      if (isMountedRef.current) {
        showCustomAlert("加载聊天记录失败: " + e.message);
      }
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const saveSession = async (session: ChatSession) => {
    try {
      await dbSaveSession(session);
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
      await dbDeleteSession(id);
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
