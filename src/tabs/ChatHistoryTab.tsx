import React, { useState } from "react";
import { LoaderCircle, MessagesSquare } from "lucide-react";
import { Button } from "../../components/ui/button";
import SessionDirectory, {
  type SessionDirectoryView,
} from "../components/session-manager/SessionDirectory";
import { useTranslation } from "../contexts/LanguageContext";
import { useUnifiedApp } from "../UnifiedAppContext";
import type { ChatSession } from "../types";

const SESSION_VIEW_STORAGE_KEY = "mobile_tavern_history_view_mode";

function readInitialView(): SessionDirectoryView {
  try {
    return localStorage.getItem(SESSION_VIEW_STORAGE_KEY) === "character"
      ? "character"
      : "recent";
  } catch {
    return "recent";
  }
}

export default function ChatHistoryTab() {
  const { t } = useTranslation();
  const {
    characters,
    sessions,
    activeSessionId,
    setActiveCharId,
    setActiveSessionId,
    setActiveTab,
    setChatSubTab,
    updateSessionMetadata,
    deleteBranch,
    showCustomPrompt,
    totalSessionCount,
    loadMoreSessions,
    hasMoreSessions,
    isLoadingMoreSessions,
  } = useUnifiedApp((state) => ({
    characters: state.characters,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    setActiveCharId: state.setActiveCharId,
    setActiveSessionId: state.setActiveSessionId,
    setActiveTab: state.setActiveTab,
    setChatSubTab: state.setChatSubTab,
    updateSessionMetadata: state.updateSessionMetadata,
    deleteBranch: state.deleteBranch,
    showCustomPrompt: state.showCustomPrompt,
    totalSessionCount: state.totalSessionCount,
    loadMoreSessions: state.loadMoreSessions,
    hasMoreSessions: state.hasMoreSessions,
    isLoadingMoreSessions: state.isLoadingMoreSessions,
  }));
  const [view, setView] = useState<SessionDirectoryView>(readInitialView);

  const changeView = (nextView: SessionDirectoryView) => {
    setView(nextView);
    try {
      localStorage.setItem(
        SESSION_VIEW_STORAGE_KEY,
        nextView === "character" ? "character" : "timeline",
      );
    } catch {
      // 界面偏好持久化失败不应影响会话管理。
    }
  };

  const openSession = (session: ChatSession) => {
    if (session.characterId) setActiveCharId(session.characterId);
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
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-3 pb-4 pt-2 sm:px-4">
      <header className="mb-3 flex min-h-14 items-center gap-3 border-b border-border/70 px-1 pb-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessagesSquare className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {t("history.title")}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("history.loaded_sessions", {
              loaded: sessions.length,
              total: totalSessionCount,
            })}
          </p>
        </span>
      </header>

      <SessionDirectory
        sessions={sessions}
        characters={characters}
        activeSessionId={activeSessionId}
        view={view}
        onViewChange={changeView}
        onOpen={openSession}
        onRename={renameSession}
        onDelete={(session) => deleteBranch(session.id)}
      />

      {sessions.length > 0 && hasMoreSessions && (
        <div className="flex justify-center py-4" aria-live="polite">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-11 min-w-40"
            disabled={isLoadingMoreSessions}
            onClick={() => void loadMoreSessions()}
          >
            {isLoadingMoreSessions && (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            )}
            {isLoadingMoreSessions ? t("history.loading_more") : t("history.load_more")}
          </Button>
        </div>
      )}
    </main>
  );
}
