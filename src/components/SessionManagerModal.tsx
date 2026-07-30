import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { GitFork, X, Trash2, Plus, LayoutGrid, Network } from "lucide-react";
import BranchUniverseDiagram from "./BranchUniverseDiagram";
import MemoryFragmentEditor from "./MemoryFragmentEditor";
import { useKernel } from "../contexts/KernelContext";
import {
  MEMORY_PERSISTENCE_SERVICE,
  type MemoryFragment,
  type MemoryPersistencePort,
} from "../application/services/memory/types";
import type { IKernelService } from "@/src/application/serviceContracts";

export default function SessionManagerModal() {
  const {
    showSessionManager,
    setShowSessionManager,
    activeCharacter,
    sessions,
    activeSession,
    setActiveSessionId,
    deleteBranch,
    createNewBranch,
    isSending,
    showCustomAlert,
  } = useUnifiedApp((state) => ({
    showSessionManager: state.showSessionManager,
    setShowSessionManager: state.setShowSessionManager,
    activeCharacter: state.activeCharacter,
    sessions: state.sessions,
    activeSession: state.activeSession,
    setActiveSessionId: state.setActiveSessionId,
    deleteBranch: state.deleteBranch,
    createNewBranch: state.createNewBranch,
    isSending: state.isSending,
    showCustomAlert: state.showCustomAlert,
  }));

  const { t } = useTranslation();
  const kernel = useKernel();
  
  // 选项卡状态："list" (列表) | "diagram" (脉络图)
  const [activeTab, setActiveTab] = useState<"list" | "diagram">("list");
  const [fragments, setFragments] = useState<MemoryFragment[]>([]);
  const [auditNode, setAuditNode] = useState<{
    sessionId: string;
    turn: number;
    fragments: MemoryFragment[];
  } | null>(null);

  const characterSessions = useMemo(
    () => activeCharacter
      ? sessions.filter((session) => session.characterId === activeCharacter.id)
      : [],
    [activeCharacter, sessions],
  );
  const persistence = useMemo(
    () => kernel.getService<MemoryPersistencePort & IKernelService>(MEMORY_PERSISTENCE_SERVICE),
    [kernel],
  );
  const loadFragments = useCallback(async () => {
    try {
      const groups = await Promise.all(
        characterSessions.map((session) => persistence.getFragmentsBySession(session.id)),
      );
      const next = groups.flat();
      setFragments(next);
      setAuditNode((current) => current ? {
        ...current,
        fragments: next.filter(
          (fragment) =>
            fragment.sessionId === current.sessionId &&
            fragment.sourceTurnEnd === current.turn,
        ),
      } : null);
    } catch (error) {
      console.warn("[SessionManagerModal] Failed to load memory fragments", error);
      setFragments([]);
    }
  }, [characterSessions, persistence]);

  useEffect(() => {
    if (showSessionManager && activeTab === "diagram") void loadFragments();
  }, [activeTab, loadFragments, showSessionManager]);

  if (!showSessionManager || !activeCharacter) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[999] flex items-center justify-center p-4 transition-all duration-200"
    >
      <div 
        className={`bg-zinc-900 border border-zinc-800 rounded-2xl w-full p-5 shadow-2xl text-foreground flex flex-col h-[75vh] max-h-[600px] transition-all duration-300 ease-out ${
          activeTab === "diagram" ? "max-w-2xl" : "max-w-sm"
        }`}
      >
        {/* 顶部标题栏 */}
        <div className="flex justify-between items-center mb-4 shrink-0">
          <p className="font-bold text-lg flex items-center gap-2 text-zinc-200">
            <GitFork className="w-5 h-5 text-primary animate-pulse" /> {t("session_manager.title") || "会话分支管理"}
          </p>
          <button
            onClick={() => setShowSessionManager(false)}
            className="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800 rounded-md transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 双模视图切换 Tab */}
        <div className="flex gap-1.5 bg-zinc-950 p-1 border border-zinc-850 rounded-xl mb-4 shrink-0">
          <button
            onClick={() => setActiveTab("list")}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
              activeTab === "list"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {t("session_manager.tab_list") || "卡片列表"}
          </button>
          <button
            onClick={() => setActiveTab("diagram")}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
              activeTab === "diagram"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Network className="w-3.5 h-3.5 animate-pulse" />
            {t("session_manager.tab_diagram") || "时空分支图"}
          </button>
        </div>

        {/* 核心内容展示区 */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {activeTab === "list" ? (
            /* 1. 列表模式：展示会话分支列表 */
            <div className="flex-1 overflow-y-auto space-y-2 pb-2 pr-1 custom-scrollbar">
              {characterSessions
                .sort((a, b) => {
                  const aLastMsg = a.messages && a.messages.length > 0 ? a.messages[a.messages.length - 1] : null;
                  const aTime = aLastMsg ? (aLastMsg.timestamp || a.createdAt) : a.createdAt;
                  const bLastMsg = b.messages && b.messages.length > 0 ? b.messages[b.messages.length - 1] : null;
                  const bTime = bLastMsg ? (bLastMsg.timestamp || b.createdAt) : b.createdAt;
                  return bTime - aTime;
                })
                .map((s) => {
                  const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
                  const lastActiveTime = lastMsg ? (lastMsg.timestamp || s.createdAt) : s.createdAt;
                  const msgs = Array.isArray(s.messages) ? s.messages : [];
                  const userMsgCount = msgs.filter((m) => m.sender === "user").length;
                  const turnCount = userMsgCount > 0 ? userMsgCount : (msgs.length > 1 ? Math.floor(msgs.length / 2) : (msgs.length > 0 ? 1 : 0));

                  return (
                    <div
                      key={s.id}
                      className={`p-3 border rounded-xl flex flex-col gap-2 transition-all cursor-pointer ${
                        s.id === activeSession?.id
                          ? "border-primary bg-primary/10"
                          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-950/60"
                      }`}
                      onClick={() => {
                        if (isSending) {
                          showCustomAlert(t("session_manager.busy_switch_warning"));
                          return;
                        }
                        setActiveSessionId(s.id);
                        setShowSessionManager(false);
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 pr-2 pb-1 flex-1">
                          <p className="font-bold text-sm truncate text-zinc-200">
                            {s.title || t("session_manager.default_branch_name")}
                          </p>
                          <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                            {new Date(lastActiveTime).toLocaleString()} |{" "}
                            {t("session_manager.turn_summary_format", { turnCount: String(turnCount), summaryCount: String((s.summaries || []).length) }) || `${turnCount}轮次`}
                          </p>
                          {lastMsg && (
                            <p className="text-[10.5px] text-zinc-400 truncate mt-2 border-t border-zinc-800/40 pt-2 italic opacity-85">
                              <span className="font-semibold text-primary">
                                {lastMsg.sender === "user" ? t("session_manager.user_label") : (activeCharacter.name || "AI")}:
                              </span>{" "}
                              {lastMsg.content}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSending) {
                              showCustomAlert(t("session_manager.busy_delete_warning"));
                              return;
                            }
                            deleteBranch(s.id);
                          }}
                          className="text-red-400 p-1.5 rounded-lg hover:bg-red-950/30 shrink-0 transition"
                          title={t("session_manager.delete_branch")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            /* 2. 可视化时空分支图模式 */
            <div className="flex-1 w-full h-full min-h-0">
              <BranchUniverseDiagram
                sessions={characterSessions}
                activeSession={activeSession}
                fragments={fragments}
                onSelectSession={(id) => {
                  if (isSending) {
                    showCustomAlert(t("session_manager.busy_switch_warning"));
                    return;
                  }
                  setActiveSessionId(id);
                  setShowSessionManager(false);
                }}
                onInspectNode={(sessionId, turn, nodeFragments) => {
                  setAuditNode({ sessionId, turn, fragments: nodeFragments });
                }}
              />
            </div>
          )}
        </div>

        {/* 底部功能按钮：新建分支 */}
        <button
          onClick={() => {
            if (isSending) {
              showCustomAlert(t("session_manager.busy_create_warning"));
              return;
            }
            createNewBranch();
          }}
          className="shrink-0 w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 flex justify-center items-center gap-2 mt-4 active:scale-95 transition-all shadow-md"
        >
          <Plus className="w-4 h-4" /> {t("session_manager.new_branch") || "新建空白分支"}
        </button>

        {/* 记忆碎片审计浮层 */}
        {auditNode && (
          <MemoryFragmentEditor
            sessionId={auditNode.sessionId}
            sourceTurnEnd={auditNode.turn}
            fragments={auditNode.fragments}
            persistence={persistence}
            onClose={() => setAuditNode(null)}
            onChanged={loadFragments}
          />
        )}
      </div>
    </div>
  );
}
