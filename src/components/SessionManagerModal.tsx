import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare, Plus, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  KernelServices,
  type IKernelService,
  type ISessionManagementService,
} from "@/src/application/serviceContracts";
import { loadActiveSessionsForCharacter } from "../application/useCases/sessionDirectoryUseCases";
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
  const [universeCharacterId, setUniverseCharacterId] = useState<string | null>(null);
  const [universeSeedSession, setUniverseSeedSession] = useState<ChatSession | null>(null);
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
  const seededUniverseSessions = useMemo(() => {
    const targetCharacterId = universeCharacterId ?? activeCharacter?.id;
    const matches = targetCharacterId
      ? sessions.filter((session) => session.characterId === targetCharacterId)
      : [];
    if (!universeSeedSession || matches.some((session) => session.id === universeSeedSession.id)) {
      return matches;
    }
    return [...matches, universeSeedSession];
  }, [activeCharacter?.id, sessions, universeCharacterId, universeSeedSession]);
  const [universeSessions, setUniverseSessions] = useState<ChatSession[]>([]);
  const sessionManagement = useMemo(
    () => kernel.getService<ISessionManagementService<ChatSession>>(KernelServices.SessionManagement),
    [kernel],
  );
  const persistence = useMemo(
    () => kernel.getService<MemoryPersistencePort & IKernelService>(MEMORY_PERSISTENCE_SERVICE),
    [kernel],
  );
  const loadFragments = useCallback(async () => {
    try {
      const groups = await Promise.all(
        universeSessions.map((session) => persistence.getFragmentsBySession(session.id)),
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
  }, [persistence, universeSessions]);

  useEffect(() => {
    if (showSessionManager && view === "universe") void loadFragments();
  }, [loadFragments, showSessionManager, view]);

  useEffect(() => {
    if (!showSessionManager || view !== "universe" || !universeCharacterId) return;
    let cancelled = false;
    setUniverseSessions(seededUniverseSessions);
    void loadActiveSessionsForCharacter(sessionManagement, universeCharacterId)
      .then((loaded) => {
        if (!cancelled) setUniverseSessions(loaded);
      })
      .catch((error: unknown) => {
        console.warn("[SessionManagerModal] Failed to load complete universe", error);
      });
    return () => { cancelled = true; };
  }, [seededUniverseSessions, sessionManagement, showSessionManager, universeCharacterId, view]);

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

  const openSession = async (session: ChatSession) => {
    if (!ensureIdle("session_manager.busy_switch_warning")) return;
    if (!await setActiveSessionId(session.id)) return;
    setActiveCharId(session.characterId);
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
        className="z-[999] flex h-[min(88dvh,720px)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-border bg-background p-0 text-foreground shadow-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-2.5">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessagesSquare className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm font-semibold">
                  {activeCharacter ? `${activeCharacter.name} · ${t("session_manager.branch_title")}` : t("session_manager.title")}
                </DialogTitle>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {activeCharacter
                    ? t("session_manager.branch_count_hint", { count: characterSessions.length })
                    : t("session_manager.subtitle")}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant={view === "universe" ? "secondary" : "outline"}
                size="sm"
                className="h-7.5 px-2.5 text-xs gap-1.5"
                onClick={() => {
                  if (view === "sessions") {
                    setUniverseCharacterId(activeCharacter?.id || null);
                    setUniverseSeedSession(activeSession);
                    setUniverseSessions(activeSession ? [activeSession] : []);
                    setView("universe");
                  } else {
                    setView("sessions");
                    setUniverseCharacterId(null);
                    setUniverseSeedSession(null);
                  }
                }}
              >
                <Plus className={`size-3.5 transition-transform ${view === "universe" ? "rotate-45" : "hidden"}`} />
                <span>{view === "sessions" ? t("session_manager.tab_universe") : t("session_manager.tab_sessions")}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label={t("common.close")}
                onClick={() => setShowSessionManager(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className={`min-h-0 flex-1 ${view === "sessions" ? "flex" : "overflow-y-auto overscroll-contain px-3 py-3"}`}>
          {view === "sessions" ? (
            <SessionManagerPanel
              activeSessionId={activeSession?.id}
              fixedCharacterId={activeCharacter?.id}
              isSending={isSending}
              onOpenSession={openSession}
              onRenameSession={renameSession}
              onOpenUniverse={(session) => { void (async () => {
                if (!ensureIdle("session_manager.busy_switch_warning")) return;
                if (!await setActiveSessionId(session.id)) return;
                setUniverseCharacterId(session.characterId);
                setUniverseSeedSession(session);
                setUniverseSessions([session]);
                setActiveCharId(session.characterId);
                setView("universe");
              })(); }}
              onDataChanged={loadSessions}
              showConfirm={showCustomConfirm}
              showAlert={showCustomAlert}
            />
          ) : (
            <div className="h-full min-h-[320px] w-full overflow-hidden rounded-2xl border border-border/70 bg-card/45">
              <BranchUniverseDiagram
                sessions={universeSessions}
                activeSession={activeSession}
                fragments={fragments}
                onSelectSession={(id) => {
                  const session = universeSessions.find((item) => item.id === id);
                  if (session) void openSession(session);
                }}
                onInspectNode={(sessionId, turn, nodeFragments) => {
                  setAuditNode({ sessionId, turn, fragments: nodeFragments });
                }}
              />
            </div>
          )}
        </div>

        {view === "sessions" && (
          <div className="shrink-0 border-t border-border/70 bg-background px-3 py-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-8.5 w-full text-xs font-semibold gap-1.5 shadow-sm"
              onClick={() => {
                if (!ensureIdle("session_manager.busy_create_warning")) return;
                setShowSessionManager(false);
                void createNewBranch();
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{t("session_manager.new_branch_chat")}</span>
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
