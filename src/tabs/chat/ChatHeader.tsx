// Header info card + 子 Tab 切换栏
// 从原 ChatTab.tsx L924-1101 抽离
// 通过 selector 订阅所需上下文字段，接收本地状态作为 props

import React from "react";
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Box,
  Activity,
  MessagesSquare,
  History,
  Table2,
  BookOpen,
  BrainCircuit,
  Braces,
  ChevronRight,
  MessageSquarePlus,
  UserRound,
  Plus,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { IBgmService } from "@/src/application/serviceContracts";
import { useArSync } from "../../hooks/ar/useArSync";
import AgentHostDiagnosticsModal from "../../components/plugins/AgentHostDiagnosticsModal";

interface ChatHeaderProps {
  openTableDrawer: (tab: 'timeline' | 'table' | 'dict' | 'recall' | 'mvu') => void;
  setIsDetailDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  enableRecall: boolean;
  enableMvuVariables: boolean;
}

const ChatHeader = ({
  openTableDrawer,
  setIsDetailDrawerOpen,
  enableRecall,
  enableMvuVariables,
}: ChatHeaderProps) => {
  const { t } = useTranslation();
  const {
    activeCharacter,
    activeSession,
    sessions,
    setActiveSessionId,
    handleStartNewSession,
    setShowSessionManager,
    setActiveTab,
    showCustomPrompt,
    setSessionViews,
    updateSessionMetadata,
    settings,
    switchUserPersona,
    addUserPersona,
    isSending,
    getKernelService,
  } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    sessions: state.sessions,
    setActiveSessionId: state.setActiveSessionId,
    handleStartNewSession: state.handleStartNewSession,
    setShowSessionManager: state.setShowSessionManager,
    setActiveTab: state.setActiveTab,
    showCustomPrompt: state.showCustomPrompt,
    setSessionViews: state.setSessionViews,
    updateSessionMetadata: state.updateSessionMetadata,
    settings: state.settings,
    switchUserPersona: state.switchUserPersona,
    addUserPersona: state.addUserPersona,
    isSending: state.isSending,
    getKernelService: state.getKernelService,
  }));

  const [isMuted, setIsMuted] = React.useState(false);
  const [showSessionMenu, setShowSessionMenu] = React.useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const recentCharacterSessions = React.useMemo(() => (
    sessions
      .filter((session) => session.characterId === activeCharacter?.id && session.lifecycle !== "archived")
      .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
      .slice(0, 5)
  ), [activeCharacter?.id, sessions]);

  // AR 入口：仅在 Android + ARCore 可用时显示按钮
  const { isArAvailable, launchAr } = useArSync({ activeSession });

  React.useEffect(() => {
    if (!showSessionMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSessionMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showSessionMenu]);

  React.useEffect(() => {
    const bgmService = getKernelService<IBgmService>("bgm");
    if (bgmService) {
      setIsMuted(bgmService.getMuteState());
    }
  }, [activeCharacter, getKernelService]);

  const toggleMute = () => {
    const bgmService = getKernelService<IBgmService>("bgm");
    if (bgmService) {
      const nextMute = bgmService.toggleMute();
      setIsMuted(nextMute);
    }
  };

  return (
    <div
      style={{ paddingTop: "calc(var(--safe-area-top) + 4px)" }}
      className="chat-header-shell sticky top-0 z-30 flex items-center justify-between gap-2 px-2.5 pb-1"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          aria-label={t("chat_header.back_aria")}
          onClick={() => setActiveTab("characters")}
          className="chat-header-action flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition hover:text-foreground active:scale-95"
        >
          <ArrowLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => setIsDetailDrawerOpen(true)}
          aria-label={t("chat_header.view_char_detail")}
          className="chat-header-avatar flex size-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted transition-opacity hover:opacity-85 active:scale-95"
          title={t("chat_header.view_char_detail")}
        >
          {activeCharacter?.avatar ? (
            <img
              src={activeCharacter.avatar}
              alt={activeCharacter.name}
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="font-serif text-base font-bold text-primary">
              {activeCharacter?.name?.[0]}
            </span>
          )}
        </button>
        <button
          type="button"
          className="flex min-h-11 min-w-0 max-w-[48vw] flex-col justify-center text-left transition-opacity hover:opacity-80 active:opacity-65"
          onClick={async () => {
            const nextTitle = await showCustomPrompt(
              t("chat_header.rename_prompt"),
              activeSession?.title || "",
            );
            if (nextTitle && activeSession) {
              const updated = { ...activeSession, title: nextTitle };
              setSessionViews((prev) =>
                prev.map((session) => (session.id === updated.id ? updated : session)),
              );
              await updateSessionMetadata(updated.id, { title: nextTitle });
            }
          }}
          aria-label="修改会话名称"
        >
          <h2 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
            {activeCharacter?.name}
          </h2>
          <span className="mt-0.5 block w-full truncate text-[10px] leading-tight text-muted-foreground/70">
            {activeSession?.title || t("session_manager.default_branch_name")} {t("chat_header.click_to_edit")}
          </span>
        </button>
      </div>

      {/* Chat sub tabs switches and settings dropdown */}
      <div className="relative flex shrink-0 items-center gap-1.5">
        {activeCharacter?.visualSettings?.bgmUrl && (
          <button
            aria-label="切换背景音乐静音状态"
            onClick={toggleMute}
            className="chat-header-action flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:text-foreground active:scale-95"
            title={isMuted ? t("chat_header.bgm_unmute") : t("chat_header.bgm_mute")}
          >
            {isMuted ? (
              <VolumeX className="size-4 text-rose-500" />
            ) : (
              <Volume2 className="size-4 text-emerald-500" />
            )}
          </button>
        )}
        {isArAvailable && (
          <button
            aria-label="启动 AR 模式"
            onClick={() => { void launchAr(); }}
            className="chat-header-action flex size-10 shrink-0 items-center justify-center rounded-xl text-primary transition hover:bg-primary/10 active:scale-95"
            title="AR 模式"
          >
            <Box className="size-4" />
          </button>
        )}
        {activeSession && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowSessionMenu(!showSessionMenu)}
              className="chat-header-action flex h-10 shrink-0 items-center justify-center rounded-xl px-3 text-primary transition hover:bg-primary/10 active:scale-95"
              aria-expanded={showSessionMenu}
              aria-controls="chat-session-tools-menu"
              title={t("chat_header.session_center")}
            >
              <span className="text-xs font-semibold">{t("chat_header.session")}</span>
            </button>
            
            {showSessionMenu && (
              <div
                id="chat-session-tools-menu"
                role="menu"
                aria-label={t("chat_header.session_center")}
                className="absolute right-0 top-full z-50 mt-1.5 flex max-h-[70vh] w-[min(18rem,calc(100vw-1.5rem))] flex-col gap-1 overflow-y-auto rounded-2xl border border-border/70 bg-popover p-2 text-popover-foreground shadow-xl animate-in fade-in slide-in-from-top-2 duration-200"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={isSending}
                  onClick={() => {
                    setShowSessionMenu(false);
                    void handleStartNewSession();
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl bg-primary/10 px-3 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
                >
                  <MessageSquarePlus className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t("chat_header.new_conversation")}</span>
                </button>

                <div className="px-2 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">
                  {t("chat_header.recent_sessions")}
                </div>
                {recentCharacterSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={session.id === activeSession.id}
                    disabled={isSending}
                    onClick={() => {
                      setShowSessionMenu(false);
                      setActiveSessionId(session.id);
                    }}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs transition-colors disabled:opacity-40 ${
                      session.id === activeSession.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {session.title || t("session_manager.default_branch_name")}
                    </span>
                    {session.id === activeSession.id && <span className="text-[9px] text-primary">{t("history.active")}</span>}
                  </button>
                ))}

                <div role="separator" className="mx-2 my-1 border-t border-border/45" />
                <div role="none" className="flex min-h-11 items-center gap-2 px-2">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t("persona.active")}</span>
                    <select
                      value={settings.activePersonaId || settings.userPersonas?.[0]?.id || ""}
                      onChange={(event) => switchUserPersona(event.target.value)}
                      className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                    >
                      {(settings.userPersonas || []).map((persona) => (
                        <option key={persona.id} value={persona.id}>{persona.name || t("persona.unnamed")}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={t("persona.create")}
                    title={t("persona.create")}
                    onClick={() => {
                      setShowSessionMenu(false);
                      void addUserPersona();
                    }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <div role="separator" className="mx-2 my-1 border-t border-border/45" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSessionMenu(false);
                    setShowSessionManager(true);
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                >
                  <MessagesSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t("session_manager.title")}</span>
                  <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSessionMenu(false);
                    setIsDiagnosticsOpen(true);
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                >
                  <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">运行诊断</span>
                  <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                </button>
                <div role="separator" className="mx-2 my-0.5 border-t border-border/45" />
                {settings.memory?.enableAutoSummary !== false && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('timeline');
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <History className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("chat_header.timeline")}</span>
                    <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                )}
                {settings.enableTableMemory && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('table');
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <Table2 className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("chat_header.table")}</span>
                    <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSessionMenu(false);
                    openTableDrawer('dict');
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                >
                  <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t("chat_header.dict")}</span>
                  <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                </button>
                {enableRecall && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('recall');
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <BrainCircuit className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("memory_drawer.tab_recall")}</span>
                    <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                )}
                {enableMvuVariables && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('mvu');
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <Braces className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("memory_drawer.tab_mvu")}</span>
                    <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AgentHostDiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
    </div>
  );
};

export default ChatHeader;
