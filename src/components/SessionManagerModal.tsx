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
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

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

  useMobileBackHandler(showSessionManager, () => {
    setShowSessionManager(false);
    return true;
  }, 900);

  if (!showSessionManager || !activeCharacter) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setShowSessionManager(false); }}>
      <DialogContent
        showCloseButton={false}
        className={`z-[999] flex h-[75dvh] max-h-[600px] flex-col gap-0 border-zinc-800 bg-zinc-900 p-5 text-foreground shadow-2xl ${
          activeTab === "diagram" ? "sm:max-w-2xl" : "sm:max-w-sm"
        }`}
      >
        {/* 顶部标题栏 */}
        <DialogHeader className="mb-4 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="font-bold text-lg flex items-center gap-2 text-zinc-200">
              <GitFork className="w-5 h-5 text-primary" /> {t("session_manager.title") || "会话分支管理"}
            </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-zinc-400 hover:text-white"
            aria-label={t("dialog.cancel")}
            onClick={() => setShowSessionManager(false)}
          >
            <X className="w-5 h-5" />
          </Button>
          </div>
        </DialogHeader>

        {/* 双模视图切换 Tab */}
        <div className="flex gap-1.5 bg-zinc-950 p-1 border border-zinc-850 rounded-xl mb-4 shrink-0">
          <button
            type="button"
            aria-pressed={activeTab === "list"}
            onClick={() => setActiveTab("list")}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
              activeTab === "list"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {t("session_manager.tab_list") || "卡片列表"}
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "diagram"}
            onClick={() => setActiveTab("diagram")}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
              activeTab === "diagram"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
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
                    <article
                      key={s.id}
                      className={`mobile-list-item flex items-center gap-1 rounded-xl border p-1 transition-colors ${
                        s.id === activeSession?.id
                          ? "border-primary bg-primary/10"
                          : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-950/60"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-h-16 min-w-0 flex-1 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          if (isSending) {
                            showCustomAlert(t("session_manager.busy_switch_warning"));
                            return;
                          }
                          setActiveSessionId(s.id);
                          setShowSessionManager(false);
                        }}
                      >
                        <div className="min-w-0 pb-1">
                          <p className="font-bold text-sm truncate text-zinc-200">
                            {s.title || t("session_manager.default_branch_name")}
                          </p>
                          <p className="text-xs text-zinc-500 mt-1 font-mono">
                            {new Date(lastActiveTime).toLocaleString()} |{" "}
                            {t("session_manager.turn_summary_format", { turnCount: String(turnCount), summaryCount: String((s.summaries || []).length) }) || `${turnCount}轮次`}
                          </p>
                          {lastMsg && (
                            <p className="text-xs text-zinc-400 truncate mt-2 border-t border-zinc-800/40 pt-2 italic opacity-85">
                              <span className="font-semibold text-primary">
                                {lastMsg.sender === "user" ? t("session_manager.user_label") : (activeCharacter.name || "AI")}:
                              </span>{" "}
                              {lastMsg.content}
                            </p>
                          )}
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 text-red-400 hover:bg-red-950/30"
                        aria-label={`${t("session_manager.delete_branch")}: ${s.title || t("session_manager.default_branch_name")}`}
                        title={t("session_manager.delete_branch")}
                        onClick={() => {
                          if (isSending) {
                            showCustomAlert(t("session_manager.busy_delete_warning"));
                            return;
                          }
                          deleteBranch(s.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </article>
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
        <Button
          type="button"
          size="lg"
          onClick={() => {
            if (isSending) {
              showCustomAlert(t("session_manager.busy_create_warning"));
              return;
            }
            createNewBranch();
          }}
          className="mt-4 min-h-11 w-full shrink-0"
        >
          <Plus className="w-4 h-4" /> {t("session_manager.new_branch") || "新建空白分支"}
        </Button>

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
      </DialogContent>
    </Dialog>
  );
}
