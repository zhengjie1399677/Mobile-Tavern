// 组合根组件：编排上述子组件
// 从原 ChatTab.tsx 主组件 L491-1868 抽离
// 通过 selector 订阅所需上下文字段，调用三个 Hook 获取派生状态，管理本地 UI 状态

import React from "react";
import { LoaderCircle } from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import CharacterDetailDrawer from "../../components/CharacterDetailDrawer";

const MemoryTableDrawer = React.lazy(() =>
  import("../../components/MemoryTableDrawer").then((module) => ({ default: module.MemoryTableDrawer }))
);

import { useChatAccessibility } from "./useChatAccessibility";
import { useChatScroll } from "./useChatScroll";
import { useCharacterPortrait } from "./useCharacterPortrait";
import ChatHeader from "./ChatHeader";
import CharacterPortraitSection from "./CharacterPortraitSection";
import DialogueHistoryView from "./DialogueHistoryView";
import StoryTimelineView from "./StoryTimelineView";
import HiddenScriptLayer from "./HiddenScriptLayer";

export default function ChatTab() {
  const {
    sessions,
    setSessions,
    settings,
    activeSessionId,
    isSending,
    chatSubTab,
    setChatSubTab,
    activeCharacter,
    activeSession,
    handleSendMessage,
    setCharacters,
    saveCharacter,
    updateSettings,
    saveSession,
    getKernelService,
    // TODO-4: 消息分页懒加载
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
  } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    setSessions: state.setSessions,
    settings: state.settings,
    activeSessionId: state.activeSessionId,
    isSending: state.isSending,
    chatSubTab: state.chatSubTab,
    setChatSubTab: state.setChatSubTab,
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    handleSendMessage: state.handleSendMessage,
    setCharacters: state.setCharacters,
    saveCharacter: state.saveCharacter,
    updateSettings: state.updateSettings,
    saveSession: state.saveSession,
    getKernelService: state.getKernelService,
    hasMoreMessages: state.hasMoreMessages,
    isLoadingMoreMessages: state.isLoadingMoreMessages,
    loadMoreMessages: state.loadMoreMessages,
  }));

  React.useEffect(() => {
    if (settings.memory?.enableAutoSummary === false && chatSubTab === "timeline") {
      setChatSubTab("dialogue");
    }
  }, [settings.memory?.enableAutoSummary, chatSubTab, setChatSubTab]);

  // a11y Live Announcer + 键盘检测 + bridge effect
  const { announcement, isKeyboardOpen } = useChatAccessibility({
    activeCharacter,
    settings,
    activeSession,
    setSessions,
    setCharacters,
    saveCharacter,
    updateSettings,
    handleSendMessage,
    isSending,
  });

  // 滚动引擎 Hook（MutationObserver / ResizeObserver / 归底逻辑）
  // TODO-4: 透传消息分页状态与回调，支持顶部触发加载更多历史
  const { scrollContainerRef, handleScroll, showScrollButton, scrollToBottom } = useChatScroll({
    activeSessionId,
    chatSubTab,
    hasMoreMessages,
    isLoadingMoreMessages,
    onLoadMoreMessages: loadMoreMessages,
  });

  // 立绘/表情 memo 计算逻辑
  const {
    hasExpressions,
    activePortraitUrl,
    currentEmotionName,
    glowColors,
    safeCustomCss,
    isOriginalBg,
  } = useCharacterPortrait({
    activeCharacter,
    activeSession,
    settings,
  });

  // 背景音乐 (BGM) 自动播放与停止控制
  const bgmUrl = activeCharacter?.visualSettings?.bgmUrl;
  const bgmVolume = activeCharacter?.visualSettings?.bgmVolume ?? 0.5;

  React.useEffect(() => {
    const bgmService = getKernelService<any>("bgm");
    if (bgmService) {
      if (bgmUrl) {
        bgmService.play(bgmUrl, bgmVolume);
      } else {
        bgmService.stop();
      }
    }
  }, [bgmUrl, bgmVolume, getKernelService]);

  // 仅在 ChatTab 完全卸载时停止 BGM
  React.useEffect(() => {
    return () => {
      const bgmService = getKernelService<any>("bgm");
      if (bgmService) {
        bgmService.stop();
      }
    };
  }, [getKernelService]);

  // 本地 UI 状态
  const [expandedReasoningIds, setExpandedReasoningIds] = React.useState<Record<string, boolean>>({});
  const [copiedReasoningIds, setCopiedReasoningIds] = React.useState<Record<string, boolean>>({});
  const [isPortraitCollapsed, setIsPortraitCollapsed] = React.useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = React.useState(false);
  const [isTableDrawerOpen, setIsTableDrawerOpen] = React.useState(false);
  const [tableDrawerTab, setTableDrawerTab] = React.useState<'timeline' | 'table' | 'dict' | 'recall' | 'mvu'>('timeline');

  const openTableDrawer = (tab: 'timeline' | 'table' | 'dict' | 'recall' | 'mvu') => {
    setTableDrawerTab(tab);
    setIsTableDrawerOpen(true);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background overflow-hidden">
      {safeCustomCss && (
        <style dangerouslySetInnerHTML={{
          __html: `@media (min-width: 768px) { ${safeCustomCss} }`
        }} />
      )}
      {/* Embedded Header info card */}
      <ChatHeader
        openTableDrawer={openTableDrawer}
        setIsDetailDrawerOpen={setIsDetailDrawerOpen}
      />

      {/* 2.5. Character Big Portrait Section (Dynamic Expressions) */}
      <CharacterPortraitSection
        activeCharacter={activeCharacter}
        hasExpressions={hasExpressions}
        activePortraitUrl={activePortraitUrl}
        currentEmotionName={currentEmotionName}
        isPortraitCollapsed={isPortraitCollapsed}
        setIsPortraitCollapsed={setIsPortraitCollapsed}
        isKeyboardOpen={isKeyboardOpen}
      />

      {/* DIALOGUE HISTORY */}
      <DialogueHistoryView
        scrollContainerRef={scrollContainerRef}
        handleScroll={handleScroll}
        showScrollButton={showScrollButton}
        scrollToBottom={scrollToBottom}
        glowColors={glowColors}
        isOriginalBg={isOriginalBg}
        activePortraitUrl={activePortraitUrl}
        isKeyboardOpen={isKeyboardOpen}
        expandedReasoningIds={expandedReasoningIds}
        setExpandedReasoningIds={setExpandedReasoningIds}
        copiedReasoningIds={copiedReasoningIds}
        setCopiedReasoningIds={setCopiedReasoningIds}
      />

      {/* Hidden script container + A11y Live Region */}
      <HiddenScriptLayer
        settings={settings}
        activeCharacter={activeCharacter}
        announcement={announcement}
      />

      <CharacterDetailDrawer
        isOpen={isDetailDrawerOpen}
        character={activeCharacter}
        onClose={() => setIsDetailDrawerOpen(false)}
      />
      {isTableDrawerOpen && activeSession && activeCharacter && (
        <React.Suspense fallback={(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px]" role="status" aria-label="正在加载记忆与状态中心">
            <div className="flex min-h-28 w-full max-w-lg items-center justify-center gap-2 rounded-t-[22px] border-t border-border/80 bg-background/95 text-xs text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
              正在打开记忆与状态中心…
            </div>
          </div>
        )}>
          <MemoryTableDrawer
            isOpen
            onClose={() => setIsTableDrawerOpen(false)}
            activeSession={activeSession}
            saveSession={saveSession}
            charName={activeCharacter.name}
            enableTableMemory={!!settings.enableTableMemory}
            enableAutoSummary={settings.memory?.enableAutoSummary !== false}
            initialTab={tableDrawerTab}
          />
        </React.Suspense>
      )}
    </div>
  );
}
