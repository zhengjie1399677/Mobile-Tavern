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
import { useKernel } from "../contexts/KernelContext";
import {
  IDatabaseService, IPromptService, ITelemetryService,
  IChatStreamService, IMultiMessageService, IScriptService, IMemoryService,
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
  const kernel = useKernel();
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
  const databaseService  = kernel.getService<IDatabaseService>("database");
  const promptService    = kernel.getService<IPromptService>("prompt");
  const telemetryService = kernel.getService<ITelemetryService>("telemetry");
  const chatStreamService = kernel.getService<IChatStreamService>("chatStream");
  const multiMessageService = kernel.getService<IMultiMessageService>("multiMessage");
  const scriptService = kernel.getService<IScriptService>("script");
  const memoryService = kernel.hasService("memory")
    ? kernel.getService<IMemoryService>("memory")
    : undefined;

  // ── 稳定 Ref 镜像（供异步回调安全读取最新值） ─────────────────────────────────
  const sessionsRef = React.useRef(sessions);
  sessionsRef.current = sessions;

  const activeSessionIdRef = React.useRef(activeSessionId);
  const activeCharIdRef    = React.useRef(activeCharId);
  activeSessionIdRef.current = activeSessionId;
  activeCharIdRef.current    = activeCharId;

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
    // P1-8: 会话/角色切换时清理 Bison 链 timer，避免堆积与对旧会话 state 进行更新
    if (ui.bisonChainTimerRef.current) {
      clearTimeout(ui.bisonChainTimerRef.current);
      ui.bisonChainTimerRef.current = null;
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
    bisonChainTimerRef: ui.bisonChainTimerRef,
    setSessions, setIsSending,
    setIsBisonLocking: ui.setIsBisonLocking,
    setReplySuggestions: ui.setReplySuggestions,
    triggerScroll: ui.triggerScroll,
    databaseService, promptService, telemetryService, chatStreamService, multiMessageService,
    memoryService,
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

  // 缺陷修复：当会话中仅有一条开场白（未开始实质对话）时，若开场白内容与角色卡最新配置不一致，自动对其进行更新同步
  useEffect(() => {
    if (
      activeSession &&
      activeCharacter &&
      activeSession.messages &&
      activeSession.messages.length === 1
    ) {
      const firstMsg = activeSession.messages[0];
      if (firstMsg.sender === "assistant") {
        const expectedGreeting = activeCharacter.first_mes || "";
        if (firstMsg.content !== expectedGreeting) {
          console.log("[useChat] Autodetected unstarted session with stale greeting. Syncing greeting...");
          const updatedMsg = {
            ...firstMsg,
            content: expectedGreeting,
            timestamp: Date.now(),
          };
          const updatedSession = {
            ...activeSession,
            messages: [updatedMsg],
          };
          databaseService.saveSession(updatedSession).then(() => {
            setSessions((prev) =>
              prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
            );
          }).catch((err) => {
            console.error("Failed to sync stale greeting session:", err);
          });
        }
      }
    }
  }, [activeSession, activeCharacter, databaseService, setSessions]);

  // 自动初始化表格：当开启状态表功能且会话中表格数据为空时，自动在本地进行初始化并保存
  useEffect(() => {
    if (
      settings.enableTableMemory &&
      activeSession &&
      activeCharacter &&
      (!activeSession.tableMemory || activeSession.tableMemory.length === 0)
    ) {
      if (memoryService) {
        console.log("[useChat] Autodetected empty tableMemory with enableTableMemory active. Initializing default sheets...");
        const defaultSheets = memoryService.getStateTable().initDefaultSheets(activeCharacter.name || "NPC");
        const updatedSession = {
          ...activeSession,
          tableMemory: defaultSheets,
        };
        databaseService.saveSession(updatedSession).then(() => {
          setSessions((prev) =>
            prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
          );
        }).catch((err) => {
          console.error("Failed to automatically initialize default sheets:", err);
        });
      }
    }
  }, [activeSession, activeCharacter, settings.enableTableMemory, databaseService, memoryService, setSessions]);

  // TODO-3: 历史消息截断与总结归档。
  // 当活跃会话内存消息数超过 ARCHIVE_THRESHOLD（200 条）且开启自动总结时，
  // 自动触发 handleAutoSummaryCheck 将旧消息归纳为 SummaryCard 归档至故事年表。
  // 总结完成后，lastSummarizedMessageId 更新，DialogueHistoryView 据此折叠已归档消息。
  const ARCHIVE_THRESHOLD = 200;
  const ARCHIVE_RETRIGGER_INCREMENT = 50; // 总结成功后，消息数再增长 50 条才允许再次触发
  const lastAutoSummaryRef = React.useRef<{ sessionId: string; messageCount: number } | null>(null);
  useEffect(() => {
    if (!activeSession || !activeSession.messages) return;
    // 仅在自动总结开启时触发
    if (settings.memory?.enableAutoSummary === false) return;
    // 仅在消息数超过阈值时触发
    if (activeSession.messages.length < ARCHIVE_THRESHOLD) return;
    // 防止对同一会话重复触发：仅在上次触发后消息数增长超过增量阈值时才再次触发
    const last = lastAutoSummaryRef.current;
    if (last && last.sessionId === activeSession.id) {
      if (activeSession.messages.length < last.messageCount + ARCHIVE_RETRIGGER_INCREMENT) return;
    }
    lastAutoSummaryRef.current = { sessionId: activeSession.id, messageCount: activeSession.messages.length };
    console.log(`[useChat] Message count ${activeSession.messages.length} >= ${ARCHIVE_THRESHOLD}, triggering auto summary archival...`);
    timelineSummary.handleAutoSummaryCheck(activeSession).catch((err) => {
      console.warn("[useChat] Auto summary archival failed:", err);
      // 失败后重置 ref，允许下次重试
      lastAutoSummaryRef.current = null;
    });
  }, [activeSession, settings.memory?.enableAutoSummary, timelineSummary]);

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
    // 兼容接口：保存会话并在有消息内容时触发 MVU 变量重解析
    saveSessionWithMvu: async (s: ChatSession, messageToParse?: string) => {
      // 如果传入了消息内容且脚本执行已启用，通过 ScriptService 触发 MVU 变量重解析
      // 遵循 AGENTS.md 准则一.3（防腐隔离）：解析失败不阻塞保存流程
      if (messageToParse && scriptService) {
        try {
          s = await scriptService.executeMvuScript(s, messageToParse);
        } catch (err) {
          console.warn("[saveSessionWithMvu] MVU re-parse failed, saving without variable update:", err);
        }
      }
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
    timelineSummary.editingSummaryId,
    ui.triggerScroll, ui.showSessionManager, ui.showFullHistory,
    ui.chatSubTab, ui.userInputMessage, ui.replySuggestions,
    ui.editingMsgId, ui.editingMsgContent, ui.msgMenuId, ui.isBisonLocking,
    renderDialogueBubble, databaseService,
  ]);
};
