// 组合根组件：编排上述子组件
// 从原 ChatTab.tsx 主组件 L491-1868 抽离
// 调用 useUnifiedApp() 获取上下文，调用三个 Hook 获取派生状态，管理本地 UI 状态

import React from "react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import CharacterDetailDrawer from "../../components/CharacterDetailDrawer";
import { MemoryTableDrawer } from "../../components/MemoryTableDrawer";

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
    activeCharacter,
    activeSession,
    handleSendMessage,
    setCharacters,
    saveCharacter,
    updateSettings,
    saveSession,
    getKernelService,
  } = useUnifiedApp();

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
  const { scrollContainerRef, handleScroll } = useChatScroll({
    activeSessionId,
    chatSubTab,
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

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background overflow-hidden">
      {safeCustomCss && (
        <style dangerouslySetInnerHTML={{
          __html: `@media (min-width: 768px) { ${safeCustomCss} }`
        }} />
      )}
      {/* Embedded Header info card */}
      <ChatHeader
        setIsTableDrawerOpen={setIsTableDrawerOpen}
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

      {/* Sub-tab 1: DIALOGUE HISTORY */}
      {chatSubTab === "dialogue" && (
        <DialogueHistoryView
          scrollContainerRef={scrollContainerRef}
          handleScroll={handleScroll}
          glowColors={glowColors}
          isOriginalBg={isOriginalBg}
          activePortraitUrl={activePortraitUrl}
          isKeyboardOpen={isKeyboardOpen}
          expandedReasoningIds={expandedReasoningIds}
          setExpandedReasoningIds={setExpandedReasoningIds}
          copiedReasoningIds={copiedReasoningIds}
          setCopiedReasoningIds={setCopiedReasoningIds}
        />
      )}

      {/* Sub-tab 2: STORY TIMELINE YEARBOOK */}
      {chatSubTab === "timeline" && (
        <StoryTimelineView />
      )}

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
      {activeSession && activeCharacter && (
        <MemoryTableDrawer
          isOpen={isTableDrawerOpen}
          onClose={() => setIsTableDrawerOpen(false)}
          activeSession={activeSession}
          saveSession={saveSession}
          charName={activeCharacter.name}
          enableTableMemory={!!settings.enableTableMemory}
        />
      )}
    </div>
  );
}
