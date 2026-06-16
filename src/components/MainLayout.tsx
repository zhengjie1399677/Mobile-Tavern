import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { SplashScreen } from "./SplashScreen";
import { VenetianMask, MessageSquare, Book, Settings } from "lucide-react";
import CharactersTab from "../tabs/CharactersTab";
import ChatHistoryTab from "../tabs/ChatHistoryTab";
import ChatTab from "../tabs/ChatTab";
import GlobalWorldbookTab from "../tabs/GlobalWorldbookTab";
import SettingsTab from "../tabs/SettingsTab";
import PlaygroundTab from "../tabs/PlaygroundTab";

import CharacterEditModal from "./CharacterEditModal";
import TimelineModal from "./TimelineModal";
import SessionManagerModal from "./SessionManagerModal";
import CustomConfirmDialog from "./CustomConfirmDialog";
import DbWritingOverlay from "./DbWritingOverlay";
import { FloatingCat } from "./FloatingCat";

export default function MainLayout() {
  const {
    activeTab,
    setActiveTab,
    showSplash,
  } = useContext(AppContext);

  return (
    <>
      <SplashScreen isVisible={showSplash} />
      <div className="flex flex-col h-[100dvh] pt-[var(--safe-area-top)] max-w-lg mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans">
        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && activeTab !== "playground" && (
          <div
            role="tablist"
            aria-label="底栏导航页签"
            className="absolute bottom-4 left-4 right-4 h-16 rounded-2xl bg-card/60 backdrop-blur-xl border border-white/10 flex items-center justify-around z-20 shadow-[0_8px_32px_0_rgba(0,0,0,0.2)]"
          >
            <button
              onClick={() => setActiveTab("characters")}
              role="tab"
              aria-selected={activeTab === "characters"}
              aria-label={`页签，角色馆${activeTab === "characters" ? "，当前选中" : ""}`}
              className={`relative flex flex-col items-center justify-center flex-1 h-full tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                activeTab === "characters"
                  ? "text-primary scale-110 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <VenetianMask className="w-5 h-5 mb-0.5" aria-hidden="true" />
              <span className="text-[10px]">角色馆</span>
              {activeTab === "characters" && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
 
            <button
              onClick={() => setActiveTab("chat-history")}
              role="tab"
              aria-selected={activeTab === "chat-history" || activeTab === "chat"}
              aria-label={`页签，历史对话${activeTab === "chat-history" ? "，当前选中" : ""}`}
              className={`relative flex flex-col items-center justify-center flex-1 h-full tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                activeTab === "chat-history" || activeTab === "chat"
                  ? "text-primary scale-110 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="w-5 h-5 mb-0.5" aria-hidden="true" />
              <span className="text-[10px]">历史对话</span>
              {(activeTab === "chat-history" || activeTab === "chat") && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
 
            <button
              onClick={() => setActiveTab("global-worldbook")}
              role="tab"
              aria-selected={activeTab === "global-worldbook"}
              aria-label={`页签，世界书${activeTab === "global-worldbook" ? "，当前选中" : ""}`}
              className={`relative flex flex-col items-center justify-center flex-1 h-full tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                activeTab === "global-worldbook"
                  ? "text-primary scale-110 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Book className="w-5 h-5 mb-0.5" aria-hidden="true" />
              <span className="text-[10px]">世界书</span>
              {activeTab === "global-worldbook" && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
 
            <button
              onClick={() => setActiveTab("settings")}
              role="tab"
              aria-selected={activeTab === "settings"}
              aria-label={`页签，控制端${activeTab === "settings" ? "，当前选中" : ""}`}
              className={`relative flex flex-col items-center justify-center flex-1 h-full tap-scale transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                activeTab === "settings"
                  ? "text-primary scale-110 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings className="w-5 h-5 mb-0.5" aria-hidden="true" />
              <span className="text-[10px]">控制端</span>
              {activeTab === "settings" && (
                <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--primary)]" />
              )}
            </button>
          </div>
        )}

        {/* 2. Content Sections Grid */}
        <div
          className={`flex-1 relative ${
            activeTab === "chat" || activeTab === "playground"
              ? "flex flex-col min-h-0 pb-0"
              : "overflow-y-auto pb-[calc(3.5rem+var(--safe-area-bottom)+12px)]"
          }`}
        >
          {/* === SECTION A: CHARACTER SELECTION === */}
          {activeTab === "characters" && <CharactersTab />}

          {/* === SECTION B.1: CHAT HISTORY (All Sessions) === */}
          {activeTab === "chat-history" && <ChatHistoryTab />}

          {/* === SECTION B: THE ACTIVE CHAT ROOM === */}
          {activeTab === "chat" && <ChatTab />}

          {/* === SECTION C: WORLDBOOK === */}
          {activeTab === "global-worldbook" && <GlobalWorldbookTab />}

          {/* === SECTION D: SYSTEM CONTROL PANEL === */}
          {activeTab === "settings" && <SettingsTab />}

          {/* === SECTION E: DEVELOPER PLAYGROUND === */}
          {activeTab === "playground" && (
            <PlaygroundTab onBack={() => setActiveTab("settings")} />
          )}
        </div>

        {/* 3. Global Modal Overlays */}
        <CharacterEditModal />
        <TimelineModal />
        <SessionManagerModal />
        <CustomConfirmDialog />
        <DbWritingOverlay />

        {/* 4. Global Cat Mascot (Only displayed on lists/settings, unmounted in chat rooms) */}
        {activeTab !== "chat" && activeTab !== "playground" && <FloatingCat />}
      </div>
    </>
  );
}
