import React, { useContext } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { GitFork, X, Trash2, Plus } from "lucide-react";

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

  if (!showSessionManager || !activeCharacter) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[999] flex items-center justify-center p-4 transition-all duration-200"
    >
      <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 shadow-2xl text-foreground flex flex-col h-[60vh] max-h-[500px]">
        <div className="flex justify-between items-center mb-4 shrink-0">
          <p className="font-bold text-lg flex items-center gap-2">
            <GitFork className="w-5 h-5 text-primary" /> {t("session_manager.title")}
          </p>
          <button
            onClick={() => setShowSessionManager(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pb-4 pr-1 custom-scrollbar">
          {sessions
            .filter((s) => s.characterId === activeCharacter.id)
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
                  className={`p-3 border rounded-lg flex flex-col gap-2 transition-colors cursor-pointer ${
                    s.id === activeSession?.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
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
                      <p className="font-bold text-sm truncate">
                        {s.title || t("session_manager.default_branch_name")}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                        {new Date(lastActiveTime).toLocaleString()} |{" "}
                        {t("session_manager.turn_summary_format", { turnCount: String(turnCount), summaryCount: String((s.summaries || []).length) })}
                      </p>
                      {lastMsg && (
                        <p className="text-[10.5px] text-muted-foreground truncate mt-1.5 border-t border-border/20 pt-1.5 italic opacity-85">
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
                      className="text-destructive p-1.5 rounded hover:bg-destructive/10 shrink-0 transition"
                      title={t("session_manager.delete_branch")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
        <button
          onClick={() => {
            if (isSending) {
              showCustomAlert(t("session_manager.busy_create_warning"));
              return;
            }
            createNewBranch();
          }}
          className="shrink-0 w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 flex justify-center items-center gap-2 mt-2"
        >
          <Plus className="w-4 h-4" /> {t("session_manager.new_branch")}
        </button>
      </div>
    </div>
  );
}
