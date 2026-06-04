import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { SplashScreen } from "./SplashScreen";
import { VenetianMask, MessageSquare, Book, Settings } from "lucide-react";
import CharactersTab from "../tabs/CharactersTab";
import ChatHistoryTab from "../tabs/ChatHistoryTab";
import ChatTab from "../tabs/ChatTab";
import GlobalWorldbookTab from "../tabs/GlobalWorldbookTab";
import SettingsTab from "../tabs/SettingsTab";

import CharacterEditModal from "./CharacterEditModal";
import TimelineModal from "./TimelineModal";
import SessionManagerModal from "./SessionManagerModal";
import CustomConfirmDialog from "./CustomConfirmDialog";
import DbWritingOverlay from "./DbWritingOverlay";

export default function MainLayout() {
  const {
    activeTab,
    setActiveTab,
    showSplash,
  } = useContext(AppContext);

  return (
    <>
      <SplashScreen isVisible={showSplash} />
      <div className="flex flex-col h-[100dvh] pt-[max(env(safe-area-inset-top),8px)] max-w-lg mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans">
        {/* 1. Main Navigation System tabs (Only on bottom, fully accessible via one-hand thumb) */}
        {activeTab !== "chat" && (
          <div className="absolute bottom-0 left-0 right-0 h-[calc(4rem+max(env(safe-area-inset-bottom),16px))] pb-[max(env(safe-area-inset-bottom),16px)] bg-background backdrop-blur border-t border-border flex items-center justify-around z-20">
            <button
              onClick={() => setActiveTab("characters")}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                activeTab === "characters"
                  ? "text-primary scale-105"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              <VenetianMask className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">角色馆</span>
            </button>

            <button
              onClick={() => setActiveTab("chat-history")}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                activeTab === "chat-history" || activeTab === "chat"
                  ? "text-primary scale-105"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              <MessageSquare className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">历史对话</span>
            </button>

            <button
              onClick={() => setActiveTab("global-worldbook")}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                activeTab === "global-worldbook"
                  ? "text-primary scale-105"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              <Book className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">世界书</span>
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                activeTab === "settings"
                  ? "text-primary scale-105"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              <Settings className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">控制端</span>
            </button>
          </div>
        )}

        {/* 2. Content Sections Grid */}
        <div
          className={`flex-1 relative ${
            activeTab === "chat"
              ? "flex flex-col min-h-0 pb-0"
              : "overflow-y-auto pb-[calc(4rem+max(env(safe-area-inset-bottom),16px))]"
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
        </div>

        {/* 3. Global Modal Overlays */}
        <CharacterEditModal />
        <TimelineModal />
        <SessionManagerModal />
        <CustomConfirmDialog />
        <DbWritingOverlay />
      </div>
    </>
  );
}
