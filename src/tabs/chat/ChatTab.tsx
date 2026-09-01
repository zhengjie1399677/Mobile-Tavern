// 组合根组件：编排上述子组件
// 从原 ChatTab.tsx 主组件 L491-1868 抽离
// 通过 selector 订阅所需上下文字段，调用三个 Hook 获取派生状态，管理本地 UI 状态

import React from "react";
import { LoaderCircle } from "lucide-react";

import { useUnifiedApp } from "../../UnifiedAppContext";
import {
  IBgmService,
  KernelServices,
  type ICompatibilityRuntimeService,
} from "@/src/application/serviceContracts";
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

function hasMvuConfiguration(extensions: unknown): boolean {
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) return false;
  const record = extensions as Record<string, unknown>;
  return Boolean(record.mvu_settings || record.mvu || record.MVU);
}

export default function ChatTab() {
  const {
    sessions,
    setSessionViews,
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
    updateSessionMetadata,
    getKernelService,
    // 单会话消息分页懒加载
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
    messageHydrationStatus,
  } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    setSessionViews: state.setSessionViews,
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
    updateSessionMetadata: state.updateSessionMetadata,
    getKernelService: state.getKernelService,
    hasMoreMessages: state.hasMoreMessages,
    isLoadingMoreMessages: state.isLoadingMoreMessages,
    loadMoreMessages: state.loadMoreMessages,
    messageHydrationStatus: state.messageHydrationStatus,
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
    setSessionViews,
    setCharacters,
    saveCharacter,
    updateSettings,
    handleSendMessage,
    isSending,
  });

  // 滚动引擎 Hook：记录用户位置，并在首次末端定位完成后开放顶部分页。
  const {
    scrollContainerRef,
    handleScroll,
    showScrollButton,
    scrollToBottom,
    markInitialPositionReady,
  } = useChatScroll({
    activeSessionId,
    chatSubTab,
    hasMoreMessages,
    isLoadingMoreMessages,
    onLoadMoreMessages: loadMoreMessages,
    messageHydrationStatus,
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
  const enableRecall = settings.memory?.enableRecall !== false;
  const enableMvuVariables = React.useMemo(() => {
    if (!settings.enableScriptExecution || !hasMvuConfiguration(activeCharacter?.extensions)) {
      return false;
    }
    try {
      return getKernelService<ICompatibilityRuntimeService>(
        KernelServices.CompatibilityRuntime,
      ).isEnabled();
    } catch {
      return false;
    }
  }, [activeCharacter?.extensions, getKernelService, settings.enableScriptExecution]);

  React.useEffect(() => {
    const bgmService = getKernelService<IBgmService>("bgm");
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
      const bgmService = getKernelService<IBgmService>("bgm");
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
    <div
      data-ui="chat-shell"
      data-emotion={currentEmotionName}
      data-emotion-glow={settings.enableEmotionAmbientGlow ? "enabled" : "disabled"}
      className="chat-shell flex flex-col flex-1 min-h-0 bg-background overflow-hidden"
      style={{
        "--emotion-glow-primary": glowColors.light1,
        "--emotion-glow-secondary": glowColors.light2,
      } as React.CSSProperties}
    >
      {safeCustomCss && (
        <style dangerouslySetInnerHTML={{
          __html: safeCustomCss
        }} />
      )}
      {/* Embedded Header info card */}
      <ChatHeader
        openTableDrawer={openTableDrawer}
        setIsDetailDrawerOpen={setIsDetailDrawerOpen}
        enableRecall={enableRecall}
        enableMvuVariables={enableMvuVariables}
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
        markInitialPositionReady={markInitialPositionReady}
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
        activeSessionId={activeSessionId}
        announcement={announcement}
      />

      <CharacterDetailDrawer
        isOpen={isDetailDrawerOpen}
        character={activeCharacter}
        onClose={() => setIsDetailDrawerOpen(false)}
      />
      {isTableDrawerOpen && activeSession && activeCharacter && (
        <React.Suspense fallback={(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" role="status" aria-label="正在加载会话资料">
            <div className="flex min-h-28 w-full max-w-lg items-center justify-center gap-2 rounded-t-3xl border-t border-border/70 bg-background text-xs text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
              正在打开会话资料…
            </div>
          </div>
        )}>
          <MemoryTableDrawer
            isOpen
            onClose={() => setIsTableDrawerOpen(false)}
            activeSession={activeSession}
            updateSessionMetadata={updateSessionMetadata}
            charName={activeCharacter.name}
            enableTableMemory={!!settings.enableTableMemory}
            enableAutoSummary={settings.memory?.enableAutoSummary !== false}
            enableRecall={enableRecall}
            enableMvuVariables={enableMvuVariables}
            initialTab={tableDrawerTab}
          />
        </React.Suspense>
      )}
    </div>
  );
}
