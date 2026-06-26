// Header info card + 子 Tab 切换栏
// 从原 ChatTab.tsx L924-1101 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收本地状态作为 props

import React from "react";
import {
  ArrowLeft,
  GitFork,
  MessageSquare,
  History,
  SlidersHorizontal,
} from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import { saveSession } from "../../utils/localDB";

interface ChatHeaderProps {
  visibleExtensions: string[];
  setVisibleExtensions: React.Dispatch<React.SetStateAction<string[]>>;
  showExtDropdown: boolean;
  setShowExtDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTableDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDetailDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const ChatHeader = ({
  visibleExtensions,
  setVisibleExtensions,
  showExtDropdown,
  setShowExtDropdown,
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
        {settings.enableTableMemory && activeSession && (
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

        {chatSubTab === "timeline" && (
          <div className="relative">
            <button
              onClick={() => setShowExtDropdown(!showExtDropdown)}
              className={`p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition ${
                showExtDropdown ? "bg-muted text-foreground" : "bg-card"
              }`}
              title="扩展字段过滤"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>

            {showExtDropdown && (
              <div className="absolute right-0 top-full mt-1.5 bg-popover border border-border rounded-lg p-2 flex flex-col gap-2 min-w-[90px] shadow-xl z-20 animate-fadeIn text-[10px]">
                <span className="text-[9px] text-muted-foreground font-bold tracking-wider uppercase px-1 border-b border-border pb-1 mb-0.5">
                  显示选项
                </span>
                <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                  <input
                    type="checkbox"
                    checked={visibleExtensions.includes("condition")}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setVisibleExtensions([...visibleExtensions, "condition"]);
                      } else {
                        setVisibleExtensions(visibleExtensions.filter(x => x !== "condition"));
                      }
                    }}
                    className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                  />
                  💓 心境
                </label>
                <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                  <input
                    type="checkbox"
                    checked={visibleExtensions.includes("inventory")}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setVisibleExtensions([...visibleExtensions, "inventory"]);
                      } else {
                        setVisibleExtensions(visibleExtensions.filter(x => x !== "inventory"));
                      }
                    }}
                    className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                  />
                  🎒 道具
                </label>
                <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                  <input
                    type="checkbox"
                    checked={visibleExtensions.includes("bonding")}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setVisibleExtensions([...visibleExtensions, "bonding"]);
                      } else {
                        setVisibleExtensions(visibleExtensions.filter(x => x !== "bonding"));
                      }
                    }}
                    className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                  />
                  🔗 羁绊
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHeader;
