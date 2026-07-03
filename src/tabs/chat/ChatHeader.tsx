// Header info card + 子 Tab 切换栏
// 从原 ChatTab.tsx L924-1101 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收本地状态作为 props

import React from "react";
import {
  ArrowLeft,
  GitFork,
  MessageSquare,
  History,
  Volume2,
  VolumeX,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";

interface ChatHeaderProps {
  setIsTableDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDetailDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChatHeader = ({
  setIsTableDrawerOpen,
  setIsDetailDrawerOpen,
}: ChatHeaderProps) => {
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
  } = useUnifiedApp();

  const [isMuted, setIsMuted] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    import("../../kernel").then(({ globalKernel }) => {
      if (!active) return;
      const bgmService = globalKernel.getService<any>("bgm");
      if (bgmService) {
        setIsMuted(bgmService.getMuteState());
      }
    });
    return () => {
      active = false;
    };
  }, [activeCharacter]);

  const toggleMute = () => {
    import("../../kernel").then(({ globalKernel }) => {
      const bgmService = globalKernel.getService<any>("bgm");
      if (bgmService) {
        const nextMute = bgmService.toggleMute();
        setIsMuted(nextMute);
      }
    });
  };

  return (
    <div
      style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
      className="bg-card px-3 pb-3 border-b border-border flex items-center justify-between sticky top-0 z-30"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={() => setActiveTab("characters")}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div
          onClick={() => setIsDetailDrawerOpen(true)}
          className="flex items-center gap-2.5 min-w-0 cursor-pointer hover:opacity-85 active:scale-98 transition-all"
          title="查看角色卡详情"
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
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSessionManager(true);
                }}
                className="text-primary hover:bg-primary/10 p-0.5 rounded transition"
                title="分支管理"
              >
                <GitFork className="w-3 h-3" />
              </button>
            </div>
            <p
              className="text-[10px] text-muted-foreground truncate mt-0.5 font-light cursor-pointer"
              onClick={async (e) => {
                e.stopPropagation();
                const nextTitle = await showCustomPrompt(
                  "修改当前分支线标题已在IndexedDB进行分支区分:",
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
              {activeSession?.title || "主剧情线"} (点击修改)
            </p>
          </div>
        </div>
      </div>

      {/* Chat sub tabs switches and settings dropdown */}
      <div className="flex items-center gap-1.5 relative">
        {activeCharacter?.visualSettings?.bgmUrl && (
          <button
            onClick={toggleMute}
            className="p-1.5 bg-muted border border-border text-muted-foreground hover:text-foreground rounded-lg transition flex items-center justify-center shrink-0"
            title={isMuted ? "开启背景音乐" : "静音背景音乐"}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-rose-500" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-500 animate-pulse" />
            )}
          </button>
        )}
        {activeSession && (
          <button
            onClick={() => setIsTableDrawerOpen(true)}
            className="p-1.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary rounded-lg transition flex items-center gap-1 shrink-0 font-sans text-xs font-bold"
            title="记忆档案柜"
          >
            <span>🌟 记忆柜</span>
          </button>
        )}
        <div className="flex shrink-0 flex-row bg-muted p-0.5 rounded-lg border border-border">
          <button
            onClick={() => setChatSubTab("dialogue")}
            className={`px-2.5 py-1 text-[11px] rounded transition font-medium flex items-center justify-center shrink-0 ${
              chatSubTab === "dialogue"
                ? "bg-primary/40 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="剧本对白"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => setChatSubTab("timeline")}
            className={`px-2.5 py-1 text-[11px] rounded transition font-medium flex items-center justify-center gap-1 shrink-0 ${
              chatSubTab === "timeline"
                ? "bg-primary/40 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="故事年表"
          >
            <History className="w-4 h-4" />
            {typeof activeSession?.summaries?.length === "number" && activeSession.summaries.length > 0 && (
              <span className="flex items-center justify-center bg-primary text-primary-foreground text-[8px] font-bold px-1 min-w-[14px] h-[14px] rounded-full scale-90 font-sans">
                {activeSession.summaries.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
