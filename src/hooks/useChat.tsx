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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { useChatState } from "../contexts/ChatContext";
import { UserSettings, LorebookEntry, CustomWorldbook, ChatSession, ChatSessionMetadataPatch, CharacterCard, Message } from "../types";
import { useKernel } from "../contexts/KernelContext";
import {
  IDatabaseService, IPromptService, ITelemetryService,
  IChatStreamService, IMultiMessageService, IScriptService,
  ISessionManagementService,
} from "@/src/application/serviceContracts";
import type { MemoryServiceTyped } from "../application/services/memory";
import type { MemoryAuditSnapshot } from "../application/services/memory/types";
import type { InstalledFullscreenPlugin } from "../domain/plugins";
import { setCompatibilityGenerationState } from "../application/useCases/compatibilityGenerationState";

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
  customWorldbooks: Record<string, CustomWorldbook>,
  launchPlugin: (plugin: InstalledFullscreenPlugin) => void
) => {
  const kernel = useKernel();
  const { showCustomAlert, showCustomConfirm, showCustomPrompt, setActiveTab } = useApp();
  const { characters, activeCharId, setActiveCharId, activeCharacter, loadCharacterById } = useCharactersState();
  const {
    sessions, setSessionViews,
    activeSessionId, setActiveSessionId,
    activeSession, isSending, setIsSending,
    deleteSession,
    refreshSessionStatistics,
    hydrateSessionMessages,
    isSummarizing, setIsSummarizing,
  } = useChatState();

  // ── 微服务注入 ────────────────────────────────────────────────────────────────
  const databaseService  = kernel.getService<IDatabaseService<ChatSession, CharacterCard, ChatSession["summaries"][number], Message, ChatSessionMetadataPatch>>("database");
  const promptService    = kernel.getService<IPromptService<CharacterCard, ChatSession, UserSettings, LorebookEntry>>("prompt");
  const telemetryService = kernel.getService<ITelemetryService>("telemetry");
  const chatStreamService = kernel.getService<IChatStreamService>("chatStream");
  const multiMessageService = kernel.getService<IMultiMessageService<ChatSession>>("multiMessage");
  const scriptService = kernel.getService<IScriptService<CharacterCard, ChatSession>>("script");
  const sessionManagementService = kernel.getService<ISessionManagementService<ChatSession>>("sessionManagement");
  const memoryService = kernel.hasService("memory")
    ? kernel.getService<MemoryServiceTyped>("memory")
    : undefined;
  const [memoryAuditSnapshot, setMemoryAuditSnapshot] = useState<MemoryAuditSnapshot | null>(null);

  // 召回结果属于当前聊天运行时快照，不写入 ChatSession；切换会话时立即清空防止串话。
  useEffect(() => {
    setMemoryAuditSnapshot(null);
  }, [activeSessionId]);

  // ── 稳定 Ref 镜像（供异步回调安全读取最新值） ─────────────────────────────────
  const sessionsRef = React.useRef(sessions);
  const activeSessionIdRef = React.useRef(activeSessionId);
  const activeCharIdRef    = React.useRef(activeCharId);
  useEffect(() => {
    sessionsRef.current = sessions;
    activeSessionIdRef.current = activeSessionId;
    activeCharIdRef.current = activeCharId;
  }, [activeCharId, activeSessionId, sessions]);

  // P1-7: 卸载保护 ref。异步持久化回调在组件卸载后
  // 仍会执行 setSessionViews，导致 React 状态更新泄漏（卸载后 setState 警告）。
  // 用 isMountedRef 在 .then 内守卫，卸载后仅放行数据落盘，不再更新 React state。
  const isMountedRef = React.useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  const publishMemoryAudit = useCallback((snapshot: MemoryAuditSnapshot) => {
    if (activeSessionIdRef.current !== snapshot.sessionId) return;
    setMemoryAuditSnapshot(snapshot);
  }, []);
  const lastMemoryAudit = memoryAuditSnapshot?.sessionId === activeSessionId
    ? memoryAuditSnapshot
    : null;
  const lastRecalledMemories = lastMemoryAudit
    ? lastMemoryAudit.recalled
    : [];

  // ── 子 Hook 装配 ──────────────────────────────────────────────────────────────
  const ui = useChatUI({
    activeSessionId, activeSession, setIsSending, chatBottomRef,
  });
  const { abortControllerRef, bisonChainTimerRef, isSendingRef } = ui;

  // 角色切换时中止正在进行的流式请求
  useEffect(() => {
    if (abortControllerRef.current) {
      console.log("[useChat] Aborting stream because active character or session changed");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      isSendingRef.current = false;
      setIsSending(false);
      setCompatibilityGenerationState(kernel, {
        isSending: false,
        streamingMessageId: null,
      });
    }
    // P1-8: 会话/角色切换时清理 Bison 链 timer，避免堆积与对旧会话 state 进行更新
    if (bisonChainTimerRef.current) {
      clearTimeout(bisonChainTimerRef.current);
      bisonChainTimerRef.current = null;
    }
  }, [abortControllerRef, activeCharId, activeSessionId, bisonChainTimerRef, isSendingRef, kernel, setIsSending]);

  // P1-2: useMemo 化 sessionManagerParams，避免每次渲染创建新对象导致
  // useSessionManager 内部所有 useCallback 依赖 [p] 形同虚设（每次都变）。
  // 稳定化后，仅当 p 的实际字段变化时才重建回调，与 useCallback 语义一致。
  const sessionManagerParams = useMemo(() => ({
    isSending, isSendingRef,
    activeCharId, activeCharacter, activeSession, activeSessionId,
    sessions, characters, settings,
    setSessionViews, loadCharacterById, setActiveCharId, setActiveSessionId, setActiveTab,
    setChatSubTab: ui.setChatSubTab,
    setShowSessionManager: ui.setShowSessionManager,
    setMsgMenuId: ui.setMsgMenuId,
    deleteSession, refreshSessionStatistics, databaseService, telemetryService,
    sessionManagementService,
    hydrateSessionMessages,
    showCustomAlert, showCustomConfirm, showCustomPrompt,
    launchPlugin,
  }), [
    isSending, isSendingRef,
    activeCharId, activeCharacter, activeSession, activeSessionId,
    sessions, characters, settings,
    setSessionViews, loadCharacterById, setActiveCharId, setActiveSessionId, setActiveTab,
    ui.setChatSubTab, ui.setShowSessionManager, ui.setMsgMenuId,
    deleteSession, refreshSessionStatistics, databaseService, telemetryService,
    sessionManagementService,
    hydrateSessionMessages,
    showCustomAlert, showCustomConfirm, showCustomPrompt, launchPlugin,
  ]);

  const sessionManager = useSessionManager(sessionManagerParams);

  const timelineSummary = useTimelineSummary({
    activeSession, settings, activeCharacter,
    setSessionViews, setIsSummarizing, databaseService, showCustomAlert,
  });

  const sendMessage = useSendMessage({
    kernel,
    settings, globalLorebook, customWorldbooks, characters,
    activeCharacter, activeSession, isSending,
    isSendingRef,
    activeRequestIdRef: ui.activeRequestIdRef,
    activeSessionIdRef, sessionsRef,
    abortControllerRef,
    pendingUpdateTimeoutRef: ui.pendingUpdateTimeoutRef,
    bisonRemainingCountRef: ui.bisonRemainingCountRef,
    bisonChainTimerRef,
    setSessionViews, setIsSending,
    setIsBisonLocking: ui.setIsBisonLocking,
    setReplySuggestions: ui.setReplySuggestions,
    triggerScroll: ui.triggerScroll,
    databaseService, promptService, telemetryService, chatStreamService, multiMessageService,
    memoryService,
    publishMemoryAudit,
    showCustomAlert, draftsRef: ui.draftsRef,
  });

  const rerollMessage = useRerollMessage({
    kernel,
    settings, globalLorebook, customWorldbooks, characters,
    activeCharacter, activeSession,
    isSendingRef,
    activeRequestIdRef: ui.activeRequestIdRef,
    activeSessionIdRef, sessionsRef,
    abortControllerRef,
    pendingUpdateTimeoutRef: ui.pendingUpdateTimeoutRef,
    setSessionViews, setIsSending,
    setReplySuggestions: ui.setReplySuggestions,
    triggerScroll: ui.triggerScroll,
    databaseService, promptService, telemetryService, chatStreamService,
    publishMemoryAudit,
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
          databaseService.appendSessionMessage(updatedSession.id, updatedMsg, 0).then(() => {
            // P1-7: 卸载保护，避免组件卸载后 setSessionViews 触发状态更新泄漏
            if (!isMountedRef.current) return;
            setSessionViews((prev) =>
              prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
            );
          }).catch((err) => {
            console.error("Failed to sync stale greeting session:", err);
          });
        }
      }
    }
  }, [activeSession, activeCharacter, databaseService, setSessionViews]);

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
        databaseService.updateSessionMetadata(updatedSession.id, { tableMemory: defaultSheets }).then(() => {
          // P1-7: 卸载保护，避免组件卸载后 setSessionViews 触发状态更新泄漏
          if (!isMountedRef.current) return;
          setSessionViews((prev) =>
            prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
          );
        }).catch((err) => {
          console.error("Failed to automatically initialize default sheets:", err);
        });
      }
    }
  }, [activeSession, activeCharacter, settings.enableTableMemory, databaseService, memoryService, setSessionViews]);

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
    lastRecalledMemories,
    lastMemoryAudit,
    // 渲染
    renderDialogueBubble,
    // 兼容接口：保存会话并在有消息内容时触发 MVU 变量重解析
    saveSessionWithMvu: async (s: ChatSession, messageToSave: Message) => {
      // 如果传入了消息内容且脚本执行已启用，通过 ScriptService 触发 MVU 变量重解析
      // 遵循 AGENTS.md 准则一.3（防腐隔离）：解析失败不阻塞保存流程
      if (scriptService) {
        try {
          s = await scriptService.executeMvuScript(s, messageToSave.content);
        } catch (err) {
          console.warn("[saveSessionWithMvu] MVU re-parse failed, saving without variable update:", err);
        }
      }
      const persisted = await databaseService.updateSessionMessage(
        s.id,
        messageToSave,
        { variables: undefined, runtimePluginState: s.runtimePluginState },
      );
      return {
        ...s,
        ...persisted,
        messages: s.messages,
      };
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
    ui.triggerScroll, ui.showSessionManager,
    ui.chatSubTab, ui.userInputMessage, ui.replySuggestions,
    ui.editingMsgId, ui.editingMsgContent, ui.msgMenuId, ui.isBisonLocking,
    lastRecalledMemories, lastMemoryAudit,
    renderDialogueBubble, databaseService,
  ]);
};
