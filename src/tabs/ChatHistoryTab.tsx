import React from "react";
import { MessagesSquare } from "lucide-react";
import SessionManagerPanel from "../components/session-manager/SessionManagerPanel";
import { useTranslation } from "../contexts/LanguageContext";
import { useUnifiedApp } from "../UnifiedAppContext";
import type { ChatSession } from "../types";

export default function ChatHistoryTab() {
  const { t } = useTranslation();
  const {
    activeSessionId,
    isSending,
    setActiveCharId,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    setShowSessionManager,
    updateSessionMetadata,
    loadSessions,
    showCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
  } = useUnifiedApp((state) => ({
    activeSessionId: state.activeSessionId,
    isSending: state.isSending,
    setActiveCharId: state.setActiveCharId,
    setActiveSessionId: state.setActiveSessionId,
    setActiveTab: state.setActiveTab,
    setChatSubTab: state.setChatSubTab,
    setShowSessionManager: state.setShowSessionManager,
    updateSessionMetadata: state.updateSessionMetadata,
    loadSessions: state.loadSessions,
    showCustomPrompt: state.showCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
  }));

  const openSession = (session: ChatSession) => {
    setActiveCharId(session.characterId);
    setActiveSessionId(session.id);
    setActiveTab("chat");
    setChatSubTab("dialogue");
  };

  const renameSession = async (session: ChatSession) => {
    const title = await showCustomPrompt(
      t("history.rename_prompt"),
      session.title || t("history.main_timeline"),
      t("history.rename"),
    );
    const normalizedTitle = title?.trim();
    if (!normalizedTitle || normalizedTitle === session.title) return;
    await updateSessionMetadata(session.id, { title: normalizedTitle });
  };

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-2 pb-3 pt-2 sm:px-4">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/70 px-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessagesSquare className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight">{t("history.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("session_manager.subtitle")}</p>
        </span>
      </header>
      <SessionManagerPanel
        activeSessionId={activeSessionId}
        isSending={isSending}
        onOpenSession={openSession}
        onRenameSession={renameSession}
        onOpenUniverse={(session) => {
          setActiveCharId(session.characterId);
          setActiveSessionId(session.id);
          setShowSessionManager(true);
        }}
        onDataChanged={loadSessions}
        showConfirm={showCustomConfirm}
        showAlert={showCustomAlert}
      />
    </main>
  );
}
