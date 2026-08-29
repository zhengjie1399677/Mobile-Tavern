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
  UserRound,
  Plus,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  IBgmService,
  KernelServices,
  type ISessionManagementService,
} from "@/src/application/serviceContracts";
import { loadActiveSessionsForCharacter } from "../../application/useCases/sessionDirectoryUseCases";
import type { ChatSession } from "../../types";
import { useArSync } from "../../hooks/ar/useArSync";
import AgentHostDiagnosticsModal from "../../components/plugins/AgentHostDiagnosticsModal";
import UserPersonaModal from "../../components/UserPersonaModal";

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
    setActiveSessionId,
    handleStartNewSession,
    setShowSessionManager,
    setActiveTab,
    showCustomPrompt,
    showCustomConfirm,
    showCustomAlert,
    setSessionViews,
    updateSessionMetadata,
    settings,
    updateSettings,
    switchUserPersona,
    isSending,
    getKernelService,
  } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    setActiveSessionId: state.setActiveSessionId,
    handleStartNewSession: state.handleStartNewSession,
    setShowSessionManager: state.setShowSessionManager,
    setActiveTab: state.setActiveTab,
    showCustomPrompt: state.showCustomPrompt,
    showCustomConfirm: state.showCustomConfirm,
    showCustomAlert: state.showCustomAlert,
    setSessionViews: state.setSessionViews,
    updateSessionMetadata: state.updateSessionMetadata,
    settings: state.settings,
    updateSettings: state.updateSettings,
    switchUserPersona: state.switchUserPersona,
    isSending: state.isSending,
    getKernelService: state.getKernelService,
  }));

  const [isMuted, setIsMuted] = React.useState(false);
  const [showSessionMenu, setShowSessionMenu] = React.useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = React.useState(false);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [recentCharacterSessions, setRecentCharacterSessions] = React.useState<ChatSession[]>([]);

  React.useEffect(() => {
    if (!showSessionMenu || !activeCharacter) return;
    let cancelled = false;
    const service = getKernelService<ISessionManagementService<ChatSession>>(KernelServices.SessionManagement);
    void loadActiveSessionsForCharacter(service, activeCharacter.id, 5)
      .then((loaded) => {
        if (!cancelled) setRecentCharacterSessions(loaded);
      })
      .catch((error: unknown) => {
        console.warn("[ChatHeader] Failed to load recent sessions", error);
      });
    return () => { cancelled = true; };
  }, [activeCharacter, getKernelService, showSessionMenu]);

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
                className="absolute right-0 top-full z-50 mt-1.5 flex max-h-[75vh] w-[min(18.5rem,calc(100vw-1.5rem))] flex-col gap-1 overflow-y-auto rounded-2xl border border-border/70 bg-popover p-2 text-popover-foreground shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
              >
                {/* 1. 分支管理板块 */}
                <div className="flex items-center justify-between px-2 pt-0.5 pb-1">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <MessagesSquare className="size-3.5 text-primary" />
                    <span>{t("chat_header.branch_management")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSessionMenu(false);
                      setShowSessionManager(true);
                    }}
                    className="text-[10px] text-primary hover:underline font-medium"
                  >
                    {t("chat_header.all_branches", { count: recentCharacterSessions.length })}
                  </button>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  disabled={isSending}
                  onClick={() => {
                    setShowSessionMenu(false);
                    void handleStartNewSession();
                  }}
                  className="flex min-h-8.5 w-full items-center gap-2 rounded-xl bg-primary/10 px-2.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:opacity-40"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t("chat_header.new_branch")}</span>
                </button>

                <div className="space-y-0.5">
                  {recentCharacterSessions.slice(0, 3).map((session) => (
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
                      className={`flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors disabled:opacity-40 ${
                        session.id === activeSession.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {session.title || t("session_manager.default_branch_name")}
                      </span>
                      {session.id === activeSession.id && <span className="text-[9px] font-semibold text-primary shrink-0">{t("history.active")}</span>}
                    </button>
                  ))}
                </div>

                {/* 2. 玩家人设板块 */}
                <div role="separator" className="mx-1 my-1 border-t border-border/45" />
                <div className="flex items-center justify-between px-2 pt-0.5 pb-1">
                  <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <UserRound className="size-3.5 text-primary" />
                    <span>{t("chat_header.persona_section")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSessionMenu(false);
                      setIsPersonaModalOpen(true);
                    }}
                    className="text-[10px] text-primary hover:underline font-medium"
                  >
                    {t("chat_header.persona_manage")}
                  </button>
                </div>

                {(() => {
                  const personas = settings.userPersonas || [];
                  const activePersona = personas.find(p => p.id === (settings.activePersonaId || "default-persona")) || personas[0];
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowSessionMenu(false);
                        setIsPersonaModalOpen(true);
                      }}
                      className="flex min-h-9 w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-2 py-1 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="flex size-6.5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary border border-border/50 text-[10px] font-bold">
                        {activePersona?.avatar ? (
                          <img src={activePersona.avatar} alt="Avatar" loading="lazy" decoding="async" className="size-full object-cover" />
                        ) : (
                          activePersona?.name?.[0] || "U"
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {activePersona?.name || t("persona.name_placeholder")}
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {activePersona?.description || t("persona.click_to_configure")}
                        </p>
                      </div>
                      <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />
                    </button>
                  );
                })()}

                {/* 3. 辅助功能与工具箱 */}
                <div role="separator" className="mx-1 my-1 border-t border-border/45" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSessionMenu(false);
                    setIsDiagnosticsOpen(true);
                  }}
                  className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">运行诊断</span>
                  <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                </button>
                {settings.memory?.enableAutoSummary !== false && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('timeline');
                    }}
                    className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <History className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("chat_header.timeline")}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
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
                    className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <Table2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("chat_header.table")}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowSessionMenu(false);
                    openTableDrawer('dict');
                  }}
                  className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <BookOpen className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{t("chat_header.dict")}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                </button>
                {enableRecall && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowSessionMenu(false);
                      openTableDrawer('recall');
                    }}
                    className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <BrainCircuit className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("memory_drawer.tab_recall")}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
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
                    className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <Braces className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t("memory_drawer.tab_mvu")}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
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

      <UserPersonaModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        settings={settings}
        updateSettings={updateSettings}
        switchUserPersona={switchUserPersona}
        showCustomConfirm={showCustomConfirm}
        showCustomAlert={showCustomAlert}
        hasActiveConversation={Boolean(activeSession && ((activeSession.messages && activeSession.messages.length > 0) || (activeSession.turnCount && activeSession.turnCount > 0)))}
      />
    </div>
  );
};

export default ChatHeader;
