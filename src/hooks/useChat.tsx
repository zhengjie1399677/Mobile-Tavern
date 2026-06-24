/**
 * useChat — 薄壳聚合器
 *
 * 本文件仅负责将各职责子 Hook 的返回值合并后透传给消费方。
 * 任何业务逻辑一律不在此处实现，请前往对应子模块：
 *
 *  UI 状态/草稿/Bison 锁/滚动  → useChat/useChatUI.ts
 *  会话/分支生命周期管理         → useChat/useSessionManager.ts
 *  时间轴摘要 & 自动总结         → useChat/useTimelineSummary.ts
 *  流式发送消息                  → useChat/useSendMessage.ts
 *  流式重新生成消息               → useChat/useRerollMessage.ts
 *  对话气泡渲染                  → useChat/useDialogueBubble.tsx
 *  共享流式纯函数                 → useChat/helpers/streamHelpers.ts
 */
import React, { useEffect, useMemo } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { UserSettings, LorebookEntry, CustomWorldbook, ChatSession } from "../types";
import { globalKernel } from "../kernel";
import {
  IDatabaseService, IPromptService, ITelemetryService,
  IChatStreamService, IMultiMessageService,
} from "../kernel/types";

import { useChatUI } from "./useChat/useChatUI";
import { useSessionManager } from "./useChat/useSessionManager";
import { useTimelineSummary } from "./useChat/useTimelineSummary";
import { useSendMessage } from "./useChat/useSendMessage";
import { useRerollMessage } from "./useChat/useRerollMessage";
import { useDialogueBubble } from "./useChat/useDialogueBubble";

// 重新导出 calculateBisonModeProbability 以保持向后兼容
export { calculateBisonModeProbability } from "./useChat/helpers";

export const useChat = (
  settings: UserSettings,
  globalLorebook: LorebookEntry[],
  chatBottomRef: React.RefObject<HTMLDivElement | null>,
  customWorldbooks: Record<string, CustomWorldbook>
) => {
  const { showCustomAlert, showCustomConfirm, showCustomPrompt, setActiveTab } = useApp();
  const { characters, activeCharId, setActiveCharId, activeCharacter } = useCharactersState();
  const {
    sessions, setSessions,
    activeSessionId, setActiveSessionId,
    activeSession, isSending, setIsSending,
    saveSession, deleteSession,
    isSummarizing, setIsSummarizing,
  } = useChatState();

  // ── 微服务注入 ────────────────────────────────────────────────────────────────
  const databaseService  = globalKernel.getService<IDatabaseService>("database");
  const promptService    = globalKernel.getService<IPromptService>("prompt");
  const telemetryService = globalKernel.getService<ITelemetryService>("telemetry");
  const chatStreamService = globalKernel.getService<IChatStreamService>("chatStream");
  const multiMessageService = globalKernel.getService<IMultiMessageService>("multiMessage");

  // ── 稳定 Ref 镜像（供异步回调安全读取最新值） ─────────────────────────────────
  const sessionsRef = React.useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const activeSessionIdRef = React.useRef(activeSessionId);
  const activeCharIdRef    = React.useRef(activeCharId);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { activeCharIdRef.current    = activeCharId;    }, [activeCharId]);

  // ── 子 Hook 装配 ──────────────────────────────────────────────────────────────
  const ui = useChatUI({
    activeSessionId, activeSession, setIsSending, chatBottomRef,
  });

  // 角色切换时中止正在进行的流式请求
  useEffect(() => {
    if (ui.abortControllerRef.current) {
      console.log("[useChat] Aborting stream because active character or session changed");
      ui.abortControllerRef.current.abort();
      ui.abortControllerRef.current = null;
      ui.isSendingRef.current = false;
      setIsSending(false);
    }
  }, [activeCharId, activeSessionId, setIsSending]);

  const sessionManager = useSessionManager({
    isSending, isSendingRef: ui.isSendingRef,
    activeCharId, activeCharacter, activeSession, activeSessionId,
    sessions, characters, settings,
    setSessions, setActiveCharId, setActiveSessionId, setActiveTab,
    setChatSubTab: ui.setChatSubTab,
    setShowSessionManager: ui.setShowSessionManager,
    setMsgMenuId: ui.setMsgMenuId,
    deleteSession, databaseService, telemetryService,
    triggerScroll: ui.triggerScroll,
    showCustomAlert, showCustomConfirm, showCustomPrompt,
  });

  const timelineSummary = useTimelineSummary({
    activeSession, settings, activeCharacter,
    setSessions, setIsSummarizing, databaseService, showCustomAlert,
  });

  const sendMessage = useSendMessage({
    settings, globalLorebook, customWorldbooks, characters,
    activeCharacter, activeSession, isSending,
    isSendingRef: ui.isSendingRef,
    activeRequestIdRef: ui.activeRequestIdRef,
    activeSessionIdRef, sessionsRef,
    abortControllerRef: ui.abortControllerRef,
    pendingUpdateTimeoutRef: ui.pendingUpdateTimeoutRef,
    bisonRemainingCountRef: ui.bisonRemainingCountRef,
    setSessions, setIsSending,
    setIsBisonLocking: ui.setIsBisonLocking,
    setReplySuggestions: ui.setReplySuggestions,
    triggerScroll: ui.triggerScroll,
    databaseService, promptService, telemetryService, chatStreamService, multiMessageService,
    showCustomAlert, draftsRef: ui.draftsRef,
  });

  const rerollMessage = useRerollMessage({
    settings, globalLorebook, customWorldbooks, characters,
    activeCharacter, activeSession,
    isSendingRef: ui.isSendingRef,
    activeRequestIdRef: ui.activeRequestIdRef,
    activeSessionIdRef, sessionsRef,
    abortControllerRef: ui.abortControllerRef,
    pendingUpdateTimeoutRef: ui.pendingUpdateTimeoutRef,
    setSessions, setIsSending,
    setReplySuggestions: ui.setReplySuggestions,
    triggerScroll: ui.triggerScroll,
    databaseService, promptService, telemetryService, chatStreamService,
    showCustomAlert, showCustomConfirm,
  });

  const { renderDialogueBubble } = useDialogueBubble({ activeCharacter, settings });

  // ── 返回值聚合（保持与原 chatHookValue 完全相同的接口形状） ─────────────────────
  return useMemo(() => ({
    // 发送/停止
    handleSendMessage: sendMessage.handleSendMessage,
    handleStopGeneration: sendMessage.handleStopGeneration,
    // 重新生成
    handleRerollFromMessage: rerollMessage.handleRerollFromMessage,
    handleRerollLast: rerollMessage.handleRerollLast,
    // 会话管理
    handleStartNewSession: sessionManager.handleStartNewSession,
    selectCharacter: sessionManager.selectCharacter,
    createNewBranch: sessionManager.createNewBranch,
    deleteBranch: sessionManager.deleteBranch,
    createBacktrackBranch: sessionManager.createBacktrackBranch,
    createBacktrackFromTimeline: sessionManager.createBacktrackFromTimeline,
    // 自动总结
    handleAutoSummaryCheck: timelineSummary.handleAutoSummaryCheck,
    // 时间轴摘要
    handleAddTimelineSummary: timelineSummary.handleAddTimelineSummary,
    timelineModalOpen: timelineSummary.timelineModalOpen,
    setTimelineModalOpen: timelineSummary.setTimelineModalOpen,
    newSummaryTag: timelineSummary.newSummaryTag,
    setNewSummaryTag: timelineSummary.setNewSummaryTag,
    newSummaryLoc: timelineSummary.newSummaryLoc,
    setNewSummaryLoc: timelineSummary.setNewSummaryLoc,
    newSummaryContent: timelineSummary.newSummaryContent,
    setNewSummaryContent: timelineSummary.setNewSummaryContent,
    newSummaryCondition: timelineSummary.newSummaryCondition,
    setNewSummaryCondition: timelineSummary.setNewSummaryCondition,
    newSummaryInventory: timelineSummary.newSummaryInventory,
    setNewSummaryInventory: timelineSummary.setNewSummaryInventory,
    newSummaryBonding: timelineSummary.newSummaryBonding,
    setNewSummaryBonding: timelineSummary.setNewSummaryBonding,
    editingSummaryId: timelineSummary.editingSummaryId,
    setEditingSummaryId: timelineSummary.setEditingSummaryId,
    // UI 状态
    triggerScroll: ui.triggerScroll,
    showSessionManager: ui.showSessionManager,
    setShowSessionManager: ui.setShowSessionManager,
    showFullHistory: ui.showFullHistory,
    setShowFullHistory: ui.setShowFullHistory,
    chatSubTab: ui.chatSubTab,
    setChatSubTab: ui.setChatSubTab,
    userInputMessage: ui.userInputMessage,
    setUserInputMessage: ui.setUserInputMessage,
    replySuggestions: ui.replySuggestions,
    setReplySuggestions: ui.setReplySuggestions,
    editingMsgId: ui.editingMsgId,
    setEditingMsgId: ui.setEditingMsgId,
    editingMsgContent: ui.editingMsgContent,
    setEditingMsgContent: ui.setEditingMsgContent,
    msgMenuId: ui.msgMenuId,
    setMsgMenuId: ui.setMsgMenuId,
    isBisonLocking: ui.isBisonLocking,
    // 渲染
    renderDialogueBubble,
    // 兼容接口
    saveSessionWithMvu: async (s: ChatSession) => {
      await databaseService.saveSession(s);
      return s;
    },
  }), [
    sendMessage.handleSendMessage, sendMessage.handleStopGeneration,
    rerollMessage.handleRerollFromMessage, rerollMessage.handleRerollLast,
    sessionManager.handleStartNewSession, sessionManager.selectCharacter,
    sessionManager.createNewBranch, sessionManager.deleteBranch,
    sessionManager.createBacktrackBranch, sessionManager.createBacktrackFromTimeline,
    timelineSummary.handleAutoSummaryCheck, timelineSummary.handleAddTimelineSummary,
    timelineSummary.timelineModalOpen, timelineSummary.newSummaryTag,
    timelineSummary.newSummaryLoc, timelineSummary.newSummaryContent,
    timelineSummary.newSummaryCondition, timelineSummary.newSummaryInventory,
    timelineSummary.newSummaryBonding, timelineSummary.editingSummaryId,
    ui.triggerScroll, ui.showSessionManager, ui.showFullHistory,
    ui.chatSubTab, ui.userInputMessage, ui.replySuggestions,
    ui.editingMsgId, ui.editingMsgContent, ui.msgMenuId, ui.isBisonLocking,
    renderDialogueBubble, databaseService,
  ]);
};
