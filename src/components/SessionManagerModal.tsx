import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare, Plus, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { IKernelService } from "@/src/application/serviceContracts";
import {
  MEMORY_PERSISTENCE_SERVICE,
  type MemoryFragment,
  type MemoryPersistencePort,
} from "../application/services/memory/types";
import { useTranslation } from "../contexts/LanguageContext";
import { useKernel } from "../contexts/KernelContext";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import type { ChatSession } from "../types";
import { useUnifiedApp } from "../UnifiedAppContext";
import BranchUniverseDiagram from "./BranchUniverseDiagram";
import MemoryFragmentEditor from "./MemoryFragmentEditor";
import SessionManagerPanel from "./session-manager/SessionManagerPanel";

type ManagerView = "sessions" | "universe";

export default function SessionManagerModal() {
  const {
    showSessionManager,
    setShowSessionManager,
    activeCharacter,
    sessions,
    activeSession,
    setActiveSessionId,
    updateSessionMetadata,
    createNewBranch,
    isSending,
    showCustomAlert,
    showCustomPrompt,
    showCustomConfirm,
    loadSessions,
    setActiveCharId,
  } = useUnifiedApp((state) => ({
    showSessionManager: state.showSessionManager,
    setShowSessionManager: state.setShowSessionManager,
    activeCharacter: state.activeCharacter,
    sessions: state.sessions,
    activeSession: state.activeSession,
    setActiveSessionId: state.setActiveSessionId,
    updateSessionMetadata: state.updateSessionMetadata,
    createNewBranch: state.createNewBranch,
    isSending: state.isSending,
    showCustomAlert: state.showCustomAlert,
    showCustomPrompt: state.showCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    loadSessions: state.loadSessions,
    setActiveCharId: state.setActiveCharId,
  }));
  const { t } = useTranslation();
  const kernel = useKernel();
  const [view, setView] = useState<ManagerView>("sessions");
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
          (fragment) => fragment.sessionId === current.sessionId
            && fragment.sourceTurnEnd === current.turn,
        ),
      } : null);
    } catch (error: unknown) {
      console.warn("[SessionManagerModal] Failed to load memory fragments", error);
      setFragments([]);
    }
  }, [characterSessions, persistence]);

  useEffect(() => {
    if (showSessionManager && view === "universe") void loadFragments();
  }, [loadFragments, showSessionManager, view]);

  useMobileBackHandler(showSessionManager, () => {
    setShowSessionManager(false);
    return true;
  }, 900);

  if (!showSessionManager) return null;

  const ensureIdle = (warningKey: string): boolean => {
    if (!isSending) return true;
    void showCustomAlert(t(warningKey));
    return false;
  };

  const openSession = (session: ChatSession) => {
    if (!ensureIdle("session_manager.busy_switch_warning")) return;
    setActiveSessionId(session.id);
    setShowSessionManager(false);
  };

  const renameSession = async (session: ChatSession) => {
    if (!ensureIdle("session_manager.busy_switch_warning")) return;
    const title = await showCustomPrompt(
      t("history.rename_prompt"),
      session.title || t("session_manager.default_branch_name"),
      t("history.rename"),
    );
    const normalizedTitle = title?.trim();
    if (!normalizedTitle || normalizedTitle === session.title) return;
    await updateSessionMetadata(session.id, { title: normalizedTitle });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setShowSessionManager(false); }}>
      <DialogContent
        showCloseButton={false}
        className="z-[999] flex h-[min(88dvh,720px)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-border bg-background p-0 text-foreground shadow-xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-3">
          <div className="flex min-h-11 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessagesSquare className="size-4.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <DialogTitle className="truncate text-base font-semibold">
                {t("session_manager.title")}
              </DialogTitle>
              <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                {activeCharacter
                  ? `${activeCharacter.name} · ${t("history.sessions_count", { count: characterSessions.length })}`
                  : t("session_manager.subtitle")}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 text-muted-foreground"
              aria-label={t("common.close")}
              onClick={() => setShowSessionManager(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        {view === "universe" && (
          <div className="shrink-0 border-b border-border/60 px-3 py-2">
            <Button variant="ghost" size="sm" className="min-h-10" onClick={() => setView("sessions")}>
              {t("common.back")} · {t("session_manager.tab_diagram")}
            </Button>
          </div>
        )}

        <div className={`min-h-0 flex-1 ${view === "sessions" ? "flex" : "overflow-y-auto overscroll-contain px-3 py-3"}`}>
          {view === "sessions" ? (
            <SessionManagerPanel
              activeSessionId={activeSession?.id}
              isSending={isSending}
              onOpenSession={openSession}
              onRenameSession={renameSession}
              onOpenUniverse={(session) => {
                if (!ensureIdle("session_manager.busy_switch_warning")) return;
                setActiveCharId(session.characterId);
                setActiveSessionId(session.id);
                setView("universe");
              }}
              onDataChanged={loadSessions}
              showConfirm={showCustomConfirm}
              showAlert={showCustomAlert}
            />
          ) : (
            <div className="h-full min-h-[320px] w-full overflow-hidden rounded-2xl border border-border/70 bg-card/45">
              {activeCharacter && <BranchUniverseDiagram
                sessions={characterSessions}
                activeSession={activeSession}
                fragments={fragments}
                onSelectSession={(id) => {
                  const session = characterSessions.find((item) => item.id === id);
                  if (session) openSession(session);
                }}
                onInspectNode={(sessionId, turn, nodeFragments) => {
                  setAuditNode({ sessionId, turn, fragments: nodeFragments });
                }}
              />}
            </div>
          )}
        </div>

        {view === "sessions" && (
          <div className="shrink-0 border-t border-border/70 bg-background px-3 py-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11 w-full"
              onClick={() => {
                if (!ensureIdle("session_manager.busy_create_warning")) return;
                void createNewBranch();
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("session_manager.new_branch")}
            </Button>
          </div>
        )}

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
