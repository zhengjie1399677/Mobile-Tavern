// Header info card + 子 Tab 切换栏
// 从原 ChatTab.tsx L924-1101 抽离
// 通过 selector 订阅所需上下文字段，接收本地状态作为 props

import React from "react";
import {
  ArrowLeft,
  GitFork,
  Volume2,
  VolumeX,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { useKernel } from "../../contexts/KernelContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { IDatabaseService } from "../../kernel/types";

interface ChatHeaderProps {
  openTableDrawer: (tab: 'timeline' | 'table' | 'dict' | 'recall' | 'mvu') => void;
  setIsDetailDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChatHeader = ({
  openTableDrawer,
  setIsDetailDrawerOpen,
}: ChatHeaderProps) => {
  const kernel = useKernel();
  const databaseService = kernel.getService<IDatabaseService>("database");
  const saveSession = (session: any) => databaseService.saveSession(session);
  const { t } = useTranslation();
  const {
    activeCharacter,
    activeSession,
    setShowSessionManager,
    setActiveTab,
    showCustomPrompt,
    setSessions,
    settings,
    chatSubTab,
    setChatSubTab,
    getKernelService,
  } = useUnifiedApp((state) => ({
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    setShowSessionManager: state.setShowSessionManager,
    setActiveTab: state.setActiveTab,
    showCustomPrompt: state.showCustomPrompt,
    setSessions: state.setSessions,
    settings: state.settings,
    chatSubTab: state.chatSubTab,
    setChatSubTab: state.setChatSubTab,
    getKernelService: state.getKernelService,
  }));

  const [isMuted, setIsMuted] = React.useState(false);
  const [showMemoryMenu, setShowMemoryMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showMemoryMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMemoryMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showMemoryMenu]);

  React.useEffect(() => {
    const bgmService = getKernelService<any>("bgm");
    if (bgmService) {
      setIsMuted(bgmService.getMuteState());
    }
  }, [activeCharacter, getKernelService]);

  const toggleMute = () => {
    const bgmService = getKernelService<any>("bgm");
    if (bgmService) {
      const nextMute = bgmService.toggleMute();
      setIsMuted(nextMute);
    }
  };

  return (
    <div
      style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
      className="bg-card px-3 pb-3 border-b border-border flex items-center justify-between sticky top-0 z-30"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          aria-label={t("chat_header.back_aria")}
          onClick={() => setActiveTab("characters")}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div
          onClick={() => setIsDetailDrawerOpen(true)}
          className="flex items-center gap-2.5 min-w-0 cursor-pointer hover:opacity-85 active:scale-98 transition-all"
          title={t("chat_header.view_char_detail")}
        >
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted border border-border/80 flex items-center justify-center flex-shrink-0">
            {activeCharacter?.avatar ? (
              <img
                src={activeCharacter.avatar}
                alt={activeCharacter.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-base font-serif font-bold text-primary">
                {activeCharacter?.name?.[0]}
              </span>
            )}
          </div>
          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-bold text-foreground truncate leading-tight">
                {activeCharacter?.name}
              </h2>
              <button
                aria-label={t("chat_header.branch_management")}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSessionManager(true);
                }}
                className="text-primary hover:bg-primary/10 p-0.5 rounded transition"
                title={t("chat_header.branch_management")}
              >
                <GitFork className="w-3 h-3" />
              </button>
            </div>
            <p
              className="text-[10px] text-muted-foreground truncate mt-0.5 font-light cursor-pointer"
              onClick={async (e) => {
                e.stopPropagation();
                const nextTitle = await showCustomPrompt(
                  t("chat_header.rename_prompt"),
                  activeSession?.title || "",
                );
                if (nextTitle && activeSession) {
                  const updated = { ...activeSession, title: nextTitle };
                  setSessions((prev: any) =>
                    prev.map((s: any) => (s.id === updated.id ? updated : s)),
                  );
                  await saveSession(updated);
                }
              }}
            >
              {activeSession?.title || t("session_manager.default_branch_name")} {t("chat_header.click_to_edit")}
            </p>
          </div>
        </div>
      </div>

      {/* Chat sub tabs switches and settings dropdown */}
      <div className="flex items-center gap-1.5 relative">
        {activeCharacter?.visualSettings?.bgmUrl && (
          <button
            aria-label="切换背景音乐静音状态"
            onClick={toggleMute}
            className="p-1.5 bg-muted border border-border text-muted-foreground hover:text-foreground rounded-lg transition flex items-center justify-center shrink-0"
            title={isMuted ? t("chat_header.bgm_unmute") : t("chat_header.bgm_mute")}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-rose-500" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-500 animate-pulse" />
            )}
          </button>
        )}
        {activeSession && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowMemoryMenu(!showMemoryMenu)}
              className="p-1.5 px-2.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary rounded-lg transition flex items-center justify-center shrink-0"
              title={t("chat_header.memory_center")}
            >
              <span className="text-[11px] font-bold">{t("chat_header.memory")}</span>
            </button>
            
            {showMemoryMenu && (
              <div className="absolute right-0 top-full mt-1.5 bg-popover/95 backdrop-blur-md text-popover-foreground border border-border rounded-xl p-1 shadow-2xl z-50 min-w-[100px] flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-2 duration-200">
                {settings.memory?.enableAutoSummary !== false && (
                  <button
                    onClick={() => {
                      setShowMemoryMenu(false);
                      openTableDrawer('timeline');
                    }}
                    className="w-full text-[11px] text-left hover:bg-primary/10 px-3 py-1.5 rounded-lg font-semibold transition"
                  >
                    {t("chat_header.timeline")}
                  </button>
                )}
                {settings.enableTableMemory && (
                  <button
                    onClick={() => {
                      setShowMemoryMenu(false);
                      openTableDrawer('table');
                    }}
                    className="w-full text-[11px] text-left hover:bg-primary/10 px-3 py-1.5 rounded-lg font-semibold transition"
                  >
                    {t("chat_header.table")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowMemoryMenu(false);
                    openTableDrawer('dict');
                  }}
                  className="w-full text-[11px] text-left hover:bg-primary/10 px-3 py-1.5 rounded-lg font-semibold transition"
                >
                  {t("chat_header.dict")}
                </button>

              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHeader;
