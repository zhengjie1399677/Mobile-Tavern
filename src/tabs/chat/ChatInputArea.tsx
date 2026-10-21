// 输入区子组件（含建议词、长按、键盘联动）
// 从原 ChatTab.tsx L39-470 抽离
// 通过 useUnifiedApp 选择器读取所需状态，接收 isKeyboardOpen 作为 prop

import React from "react";
import { Send, Square } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { useComposerAutosize } from "./useComposerInputPath";
import {
  KernelServices,
  type IAttachmentService,
  type IComposerCommandService,
} from "@/src/application/serviceContracts";
import { getSessionRuntimeProfileId } from "@/src/application/useCases/runtimeProfileSession";
import {
  BUILTIN_COMPOSER_COMMANDS,
  executeBuiltinComposerCommand,
  filterComposerCommandSuggestions,
  resolveComposerCommandInvocation,
} from "@/src/application/useCases/composerCommandUseCases";
import type { ComposerCommandDescriptor } from "@/src/domain/composer/contracts";
import type { MessageContentPart } from "../../domain/messages/messageContent";
import { AttachmentPicker } from "./attachment-composer/AttachmentPicker";
import {
  PendingAttachmentStrip,
  type PendingAttachment,
} from "./attachment-composer/PendingAttachmentStrip";
import { ComposerCommandSuggestions } from "./ComposerCommandSuggestions";
import { ComposerQuickActionBar } from "./composer-panels/ComposerQuickActionBar";
import { ComposerReplySuggestions } from "./composer-panels/ComposerReplySuggestions";
import { QuickActionManagerModal } from "./composer-panels/QuickActionManagerModal";
import {
  loadQuickActionModulesConfig,
  saveQuickActionModulesConfig,
  type QuickActionModulesConfig,
} from "./composer-panels/quickActionTypes";
import { useChatVoiceInput } from "./useChatVoiceInput";
import { VoiceDraftHint } from "./voice-composer/VoiceDraftHint";
import { VoiceHoldButton } from "./voice-composer/VoiceHoldButton";
import { VoiceHoldOverlay } from "./voice-composer/VoiceHoldOverlay";
import { VoiceModeToggle } from "./voice-composer/VoiceModeToggle";

function toMessageAttachmentPart(item: PendingAttachment): MessageContentPart {
  const { metadata } = item;
  if (metadata.kind === "image") return { type: "image", assetId: metadata.id };
  if (metadata.kind === "audio") {
    return {
      type: "audio",
      assetId: metadata.id,
      purpose: item.purpose === "model-input" ? "model-input" : undefined,
    };
  }
  if (metadata.kind === "video") return { type: "video", assetId: metadata.id };
  return { type: "file", assetId: metadata.id, displayName: metadata.originalName };
}

const QUICK_ACTIONS_STORAGE_KEY = "mobile_tavern_show_quick_actions";

const ChatInputArea = ({
  isKeyboardOpen,
  messageScrollerRef,
}: {
  isKeyboardOpen: boolean;
  /** 消息列表滚动容器：仅用于输入区高度变化时的同帧贴底补偿，缺省时不做任何滚动干预。 */
  messageScrollerRef?: React.RefObject<HTMLDivElement | null>;
}) => {
  const [showQuickActions, setShowQuickActions] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(QUICK_ACTIONS_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [quickActionModules, setQuickActionModules] = React.useState<QuickActionModulesConfig>(() =>
    loadQuickActionModulesConfig()
  );
  const [quickActionManagerOpen, setQuickActionManagerOpen] = React.useState(false);

  const handleUpdateQuickActionModules = React.useCallback((next: QuickActionModulesConfig) => {
    setQuickActionModules(next);
    saveQuickActionModulesConfig(next);
  }, []);

  const handleToggleQuickActions = React.useCallback(() => {
    setShowQuickActions((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(QUICK_ACTIONS_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const [mcpPopoverOpen, setMcpPopoverOpen] = React.useState(false);
  const [mcpSeedText, setMcpSeedText] = React.useState("");
  const { t } = useTranslation();
  const {
    isSending,
    activeSession,
    settings,
    activeCharacter,
    handleRerollLast,
    showCustomAlert,

    handleSendMessage,
    handleStopGeneration,
    safeAreas,
    userInputMessage,
    setUserInputMessage,
    setReplySuggestions,
    isBisonLocking,
    triggerScroll,
    getKernelService,
    messageHydrationStatus,
    handleStartNewSession,
    createNewBranch,
    handleAutoSummaryCheck,
    showCustomConfirm,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    activeSession: state.activeSession,
    settings: state.settings,
    activeCharacter: state.activeCharacter,
    handleRerollLast: state.handleRerollLast,
    showCustomAlert: state.showCustomAlert,
    handleSendMessage: state.handleSendMessage,
    handleStopGeneration: state.handleStopGeneration,
    safeAreas: state.safeAreas,
    userInputMessage: state.userInputMessage,
    setUserInputMessage: state.setUserInputMessage,
    setReplySuggestions: state.setReplySuggestions,
    isBisonLocking: state.isBisonLocking,
    triggerScroll: state.triggerScroll,
    getKernelService: state.getKernelService,
    messageHydrationStatus: state.messageHydrationStatus,
    handleStartNewSession: state.handleStartNewSession,
    createNewBranch: state.createNewBranch,
    handleAutoSummaryCheck: state.handleAutoSummaryCheck,
    showCustomConfirm: state.showCustomConfirm,
  }));

  React.useEffect(() => {
    let scrollRafId: number | null = null;
    const handleWindowScroll = () => {
      if (
        window.scrollY !== 0 ||
        window.scrollX !== 0 ||
        document.body.scrollTop !== 0 ||
        document.documentElement.scrollTop !== 0
      ) {
        if (scrollRafId) cancelAnimationFrame(scrollRafId);
        scrollRafId = requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        });
      }
    };
    window.addEventListener("scroll", handleWindowScroll, { passive: false });

    const resetScroll = () => {
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      scrollRafId = requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      });
    };

    const vvp = window.visualViewport;
    if (vvp) {
      vvp.addEventListener("resize", resetScroll);
    }

    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      if (vvp) {
        vvp.removeEventListener("resize", resetScroll);
      }
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
    };
  }, []);

  const [localInput, setLocalInput] = React.useState(userInputMessage);
  const [isExecutingComposerCommand, setIsExecutingComposerCommand] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<PendingAttachment[]>([]);

  const localInputRef = React.useRef(localInput);
  React.useEffect(() => {
    localInputRef.current = localInput;
  }, [localInput]);

  const pendingAttachmentsRef = React.useRef(pendingAttachments);
  React.useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  const handleSendMessageRef = React.useRef(handleSendMessage);
  React.useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  /** 发送成功后的统一收尾：单纯发送 / 合并发送 / 松手发送三条路径共用。 */
  const clearComposerAfterSend = React.useCallback(() => {
    setPendingAttachments([]);
    setLocalInput("");
    setUserInputMessage("");
    setReplySuggestions([]);
  }, [setLocalInput, setPendingAttachments, setReplySuggestions, setUserInputMessage]);

  /**
   * 语音收尾的唯一发送出口（松手发送与到点自动发送共用）。
   * 发送被拒时不清空任何东西：录音是一次性的，不能被静默销毁。
   */
  const sendVoiceMessage = React.useCallback(async (attachment: PendingAttachment) => {
    const all = [
      ...pendingAttachmentsRef.current.filter((item) => item.metadata.id !== attachment.metadata.id),
      attachment,
    ];
    const sent = await handleSendMessageRef.current(localInputRef.current.trim(), {
      skipAI: false,
      attachmentIds: all.map((item) => item.metadata.id),
      attachmentParts: all.map(toMessageAttachmentPart),
    });
    if (!sent) return;
    clearComposerAfterSend();
  }, [setLocalInput, setPendingAttachments, setReplySuggestions, setUserInputMessage, clearComposerAfterSend]);

  const {
    isVoiceMode,
    setIsVoiceMode,
    isHolding,
    isCancelHovered,
    cancelSwipeProgress,
    holdDurationMs,
    voiceAmplitude,
    isLimitWarning,
    startHoldRecord,
    cancelHoldRecord,
    finishHoldRecord,
    voicePointerHandlers,
  } = useChatVoiceInput({
    activeSessionId: activeSession?.id,
    pendingAttachments,
    setPendingAttachments,
    getKernelService,
    showCustomAlert,
    sendVoiceMessage,
  });

  React.useEffect(() => {
    setPendingAttachments([]);
  }, [activeSession?.id]);

  const handleSelectAttachments = React.useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    const remainingSlots = Math.max(0, 4 - pendingAttachments.length);
    if (remainingSlots === 0) {
      await showCustomAlert("每条消息最多添加 4 个附件。");
      return;
    }
    const service = getKernelService<IAttachmentService>("attachments");
    const imported: PendingAttachment[] = [];
    try {
      for (const file of files.slice(0, remainingSlots)) {
        const metadata = await service.stageFile(file);
        imported.push({
          metadata,
          previewUrl: await service.getObjectUrl(metadata.id),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showCustomAlert(`附件导入失败：${message}`);
    }
    if (imported.length > 0) setPendingAttachments(current => [...current, ...imported]);
  }, [getKernelService, pendingAttachments.length, setPendingAttachments, showCustomAlert]);

  React.useEffect(() => {
    setLocalInput(userInputMessage);
  }, [userInputMessage]);

  React.useEffect(() => {
    return () => {
      setUserInputMessage(localInputRef.current);
    };
  }, [activeSession?.id, setUserInputMessage]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 自适应高度与"贴底才补偿"的滚动修正都收在按键路径 Hook 内（见 useComposerInputPath）。
  useComposerAutosize({ textareaRef, value: localInput, messageScrollerRef });

  React.useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scrollInputIntoView = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      if (document.activeElement !== textarea) return;
      triggerScroll("auto");
    };

    if (isKeyboardOpen) {
      scrollInputIntoView();
      // 等待软键盘展开动画结束、视口高度调整彻底稳定执行二次修正
      timeoutId = setTimeout(() => {
        scrollInputIntoView();
      }, 250);
    }

    // 监听聚焦，如果是聚焦，也延迟滚动以防万一
    const textarea = textareaRef.current;
    const handleFocus = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        scrollInputIntoView();
      }, 300);
    };

    if (textarea) {
      textarea.addEventListener("focus", handleFocus);
    }

    return () => {
      if (textarea) {
        textarea.removeEventListener("focus", handleFocus);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
    // isVoiceMode 参与依赖：语音模式会卸载 textarea，不重绑就会把监听留在已分离的节点上。
  }, [isKeyboardOpen, isVoiceMode, triggerScroll]);

  const lastMsgIsUser = React.useMemo(() => {
    if (!activeSession || !Array.isArray(activeSession.messages) || activeSession.messages.length === 0) return false;
    return activeSession.messages[activeSession.messages.length - 1].sender === "user";
  }, [activeSession]);

  const composerProfileId = React.useMemo(
    () => getSessionRuntimeProfileId(activeSession),
    [activeSession],
  );
  const composerCommands = React.useMemo<ComposerCommandDescriptor[]>(() => {
    let pluginCommands: ComposerCommandDescriptor[] = [];
    if (composerProfileId) {
      try {
        pluginCommands = [...getKernelService<IComposerCommandService>(KernelServices.ComposerCommands)
          .list(composerProfileId)];
      } catch {
        // 命令注册表是可降级服务；缺失时输入框维持普通文本行为（仍保留宿主内置命令）。
        pluginCommands = [];
      }
    }
    const map = new Map<string, ComposerCommandDescriptor>();
    for (const cmd of BUILTIN_COMPOSER_COMMANDS) {
      map.set(cmd.name, cmd);
    }
    for (const cmd of pluginCommands) {
      map.set(cmd.name, cmd);
    }
    return Array.from(map.values());
  }, [composerProfileId, getKernelService]);
  const composerCommandSuggestions = filterComposerCommandSuggestions(localInput, composerCommands);
  const [selectedCommandIndex, setSelectedCommandIndex] = React.useState(0);

  React.useEffect(() => {
    setSelectedCommandIndex(0);
  }, [localInput]);

  const openMcpPopover = React.useCallback((seed: string) => {
    setMcpSeedText(seed);
    setMcpPopoverOpen(true);
  }, []);

  /**
   * 工具结果只插入输入框（数据正文），不自动发送、不触发模型。
   * 用户可自行编辑后再决定怎么使用这段资料。
   */
  const handleInsertToolData = React.useCallback((data: string): void => {
    const text = data.trim();
    if (!text) return;
    const current = localInput || "";
    const next = current.trim() ? `${current.trim()}\n\n${text}` : text;
    setLocalInput(next);
    setUserInputMessage(next);
    setReplySuggestions([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [localInput, setLocalInput, setReplySuggestions, setUserInputMessage]);

  const executeComposerCommand = React.useCallback(async (
    command: ComposerCommandDescriptor,
    argument: string,
  ): Promise<void> => {
    if (!activeSession || isExecutingComposerCommand) return;

    if (command.owner === "host.builtin") {
      // `/tool [查询]` 走显性调用面板：列出已启用工具并自动匹配 / 预填查询。
      if (command.name === "tool") {
        if (settings.enableExternalCapabilities !== true) {
          await showCustomAlert(
            "外部能力（MCP）总开关当前是关闭的。\n\n请到 工作台 → 扩展能力 打开「启用外部能力（MCP）」后再使用。",
            "外部能力已关闭",
          );
          setLocalInput("");
          setUserInputMessage("");
          return;
        }
        setLocalInput("");
        setUserInputMessage("");
        setReplySuggestions([]);
        openMcpPopover(argument.trim());
        return;
      }
      await executeBuiltinComposerCommand({
        commandName: command.name,
        argument,
        hasActiveSession: Boolean(activeSession),
        continueText: t("chat_input.continue"),
        handleSendMessage,
        handleRerollLast,
        handleStartNewSession,
        createNewBranch,
        handleAutoSummaryCheck: async () => {
          if (activeSession) await handleAutoSummaryCheck(activeSession, true);
        },
        showCustomConfirm,
        showCustomAlert,
        setLocalInput,
        setUserInputMessage,
        setReplySuggestions: () => setReplySuggestions([]),
        focusTextarea: () => textareaRef.current?.focus(),
        availableCommands: composerCommands,
      });
      return;
    }

    if (!composerProfileId) return;
    if (command.acceptsArgument && !argument) {
      await showCustomAlert(`/${command.name} 需要在命令后输入参数。`, "命令参数缺失");
      return;
    }
    if (!command.acceptsArgument && argument) {
      await showCustomAlert(`/${command.name} 不接受额外参数。`, "命令参数无效");
      return;
    }
    setIsExecutingComposerCommand(true);
    try {
      const result = await getKernelService<IComposerCommandService>(KernelServices.ComposerCommands)
        .execute(command.name, {
          profileId: composerProfileId,
          sessionId: activeSession.id,
          argument,
        });
      setLocalInput(result);
      setUserInputMessage(result);
      setReplySuggestions([]);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showCustomAlert(`无法执行 /${command.name}：${message}`, "输入框命令失败");
    } finally {
      setIsExecutingComposerCommand(false);
    }
  }, [
    activeSession,
    composerCommands,
    composerProfileId,
    createNewBranch,
    getKernelService,
    handleAutoSummaryCheck,
    handleRerollLast,
    handleSendMessage,
    handleStartNewSession,
    isExecutingComposerCommand,
    setLocalInput,
    setReplySuggestions,
    setUserInputMessage,
    showCustomAlert,
    showCustomConfirm,
    t,
    openMcpPopover,
    settings.enableExternalCapabilities,
  ]);

  const executeComposerCommandIfPresent = React.useCallback(async (): Promise<boolean> => {
    const invocation = resolveComposerCommandInvocation(localInput, composerCommands);
    if (!invocation) return false;
    await executeComposerCommand(invocation.command, invocation.argument);
    return true;
  }, [composerCommands, executeComposerCommand, localInput]);

  const canSend = React.useMemo(() => {
    if (!activeSession || messageHydrationStatus !== "ready" || isHolding || isExecutingComposerCommand) return false;
    const hasInput = (localInput || "").trim() !== "";
    const hasAttachments = pendingAttachments.length > 0;
    if (settings.enableMultiMessageQueue) {
      return hasInput || hasAttachments || lastMsgIsUser;
    }
    return hasInput || hasAttachments;
  }, [activeSession, isExecutingComposerCommand, isHolding, localInput, messageHydrationStatus, pendingAttachments.length, settings.enableMultiMessageQueue, lastMsgIsUser]);

  /** 发送成功后的统一收尾：文本、语音两条路径（单纯发送 / 合并发送 / 松手发送）共用。 */
  const onSendPure = React.useCallback(async () => {
    if (!localInput.trim() && pendingAttachments.length === 0) return;
    if (await executeComposerCommandIfPresent()) return;
    const msg = localInput;
    let sent = false;
    try {
      sent = await handleSendMessage(msg, {
        skipAI: true,
        attachmentIds: pendingAttachments.map(item => item.metadata.id),
        attachmentParts: pendingAttachments.map(toMessageAttachmentPart),
      });
    } catch {
      return;
    }
    // 发送被拒（Provider 未声明能力 / Profile 不匹配）时保留输入与附件，只清空已发出的内容。
    if (!sent) return;
    clearComposerAfterSend();
  }, [
    localInput,
    pendingAttachments,
    executeComposerCommandIfPresent,
    handleSendMessage,
    clearComposerAfterSend,
  ]);

  const onSendMerged = React.useCallback(async () => {
    if (await executeComposerCommandIfPresent()) return;
    const msg = localInput.trim();
    let sent = false;
    try {
      sent = await handleSendMessage(msg, {
        skipAI: false,
        attachmentIds: pendingAttachments.map(item => item.metadata.id),
        attachmentParts: pendingAttachments.map(toMessageAttachmentPart),
      });
    } catch {
      return;
    }
    if (!sent) return;
    clearComposerAfterSend();
  }, [
    localInput,
    pendingAttachments,
    executeComposerCommandIfPresent,
    handleSendMessage,
    clearComposerAfterSend,
  ]);

  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTriggeredLongPress = React.useRef(false);

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (isSending) return;
    if (!settings.enableMultiMessageQueue) return;

    hasTriggeredLongPress.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      hasTriggeredLongPress.current = true;
      void onSendMerged();
    }, 500);
  }, [isSending, onSendMerged, settings.enableMultiMessageQueue]);

  const handlePointerUp = React.useCallback((_e: React.PointerEvent) => {
    if (!settings.enableMultiMessageQueue) {
      void onSendMerged();
      return;
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!hasTriggeredLongPress.current) {
      void onSendPure();
    }
    hasTriggeredLongPress.current = false;
  }, [onSendPure, onSendMerged, settings.enableMultiMessageQueue]);

  const handlePointerCancel = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    hasTriggeredLongPress.current = false;
  }, []);

  return (
    <div
      id="chat-input-area-container"
      ref={containerRef}
      style={{
        paddingBottom: `${isKeyboardOpen ? 4 : Math.max(safeAreas?.bottom ?? 0, 10)}px`
      }}
      className="chat-composer-shell z-10 flex shrink-0 flex-col items-center gap-2 px-3 pt-2.5"
    >
      <ComposerQuickActionBar
        visible={showQuickActions}
        isHolding={isHolding}
        draftText={localInput}
        onInsertData={handleInsertToolData}
        mcpPopoverOpen={mcpPopoverOpen}
        onMcpPopoverOpenChange={(next) => {
          if (next) setMcpSeedText((localInput || "").trim());
          setMcpPopoverOpen(next);
        }}
        mcpSeedText={mcpSeedText}
        modulesConfig={quickActionModules}
        availableCommands={composerCommands}
        onSelectCommand={(command) => {
          if (command.acceptsArgument) {
            const nextInput = `/${command.name} `;
            setLocalInput(nextInput);
            setUserInputMessage(nextInput);
            requestAnimationFrame(() => textareaRef.current?.focus());
          } else {
            void executeComposerCommand(command, "");
          }
        }}
      />
      <ComposerReplySuggestions
        commandSuggestionsVisible={composerCommandSuggestions.length > 0}
      />
      {!isSending && (
        <ComposerCommandSuggestions
          suggestions={composerCommandSuggestions}
          selectedIndex={selectedCommandIndex}
          isExecuting={isExecutingComposerCommand}
          onSelectCommand={(command) => {
            if (command.acceptsArgument) {
              const nextInput = `/${command.name} `;
              setLocalInput(nextInput);
              setUserInputMessage(nextInput);
              requestAnimationFrame(() => textareaRef.current?.focus());
            } else {
              void executeComposerCommand(command, "");
            }
          }}
          onHoverIndex={setSelectedCommandIndex}
        />
      )}
      <PendingAttachmentStrip
        items={pendingAttachments}
        maxCount={4}
        onRemove={(assetId) => setPendingAttachments((current) => (
          current.filter((candidate) => candidate.metadata.id !== assetId)
        ))}
      />
      {isHolding && (
        <VoiceHoldOverlay
          isCancelHovered={isCancelHovered}
          cancelSwipeProgress={cancelSwipeProgress}
          isLimitWarning={isLimitWarning}
          amplitude={voiceAmplitude}
          holdDurationMs={holdDurationMs}
        />
      )}
      {isVoiceMode && (
        <VoiceDraftHint
          draft={localInput}
          onClear={() => {
            setLocalInput("");
            setUserInputMessage("");
          }}
        />
      )}
      <div className="chat-composer-row relative flex w-full max-w-3xl items-end gap-1.5 rounded-2xl p-1">
        <VoiceModeToggle
          isVoiceMode={isVoiceMode}
          disabled={isSending || isBisonLocking || isHolding}
          onToggle={() => setIsVoiceMode((prev) => !prev)}
        />

        {isVoiceMode ? (
          <VoiceHoldButton
            isHolding={isHolding}
            isCancelHovered={isCancelHovered}
            disabled={isSending || isBisonLocking || messageHydrationStatus !== "ready"}
            pointerHandlers={voicePointerHandlers}
            onHoldStart={() => void startHoldRecord()}
            onHoldEnd={() => void finishHoldRecord("release")}
            onHoldCancel={() => void cancelHoldRecord()}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            onKeyDown={(e) => {
              if (composerCommandSuggestions.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) => (prev + 1) % composerCommandSuggestions.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) => (prev - 1 + composerCommandSuggestions.length) % composerCommandSuggestions.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  const targetCmd = composerCommandSuggestions[selectedCommandIndex] || composerCommandSuggestions[0];
                  if (targetCmd) {
                    e.preventDefault();
                    if (targetCmd.acceptsArgument) {
                      const nextInput = `/${targetCmd.name} `;
                      setLocalInput(nextInput);
                      setUserInputMessage(nextInput);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    } else {
                      void executeComposerCommand(targetCmd, "");
                    }
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setLocalInput("");
                  setUserInputMessage("");
                  return;
                }
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (settings.enableMultiMessageQueue) {
                  void onSendPure();
                } else {
                  void onSendMerged();
                }
              }
            }}
            disabled={isBisonLocking || isSending || messageHydrationStatus !== "ready"}
            inputMode="text"
            enterKeyHint="send"
            placeholder={
              isBisonLocking
                ? t("chat_input.placeholder_bison", { name: activeCharacter?.name || "角色" })
                : messageHydrationStatus !== "ready"
                  ? "正在准备聊天记录…"
                  : t("chat_input.placeholder_default", { name: activeCharacter?.name || "" })
            }
            aria-label={t("chat_input.aria_label", { name: activeCharacter?.name || "角色" })}
            rows={1}
            className={`chat-composer-input min-h-[38px] max-h-[160px] flex-1 resize-none overflow-y-auto rounded-xl bg-transparent pl-1 pr-2.5 py-[9px] text-sm font-normal leading-5 text-foreground placeholder:text-muted-foreground/55 focus:outline-none ${(isBisonLocking || isSending) ? "opacity-50 cursor-not-allowed text-muted-foreground" : ""
              }`}
          />
        )}

        <AttachmentPicker
          disabled={isSending || isBisonLocking || isHolding}
          selectedCount={pendingAttachments.length}
          maxCount={4}
          quickActionsVisible={showQuickActions}
          onSelect={handleSelectAttachments}
          onToggleQuickActions={handleToggleQuickActions}
          onOpenQuickActionManager={() => setQuickActionManagerOpen(true)}
          onTriggerSlash={() => {
            if (isVoiceMode) setIsVoiceMode(false);
            setLocalInput("/");
            setUserInputMessage("/");
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />

        {isSending ? (
          <button
            onClick={() => handleStopGeneration()}
            aria-label={t("chat_input.stop")}
            title={t("chat_input.stop")}
            className="chat-send-button flex size-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl bg-destructive text-destructive-foreground transition-colors duration-200 hover:bg-destructive/90 active:scale-95"
          >
            <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerCancel}
            disabled={!canSend}
            aria-label={
              settings.enableMultiMessageQueue
                ? t("chat_input.send_title")
                : t("chat_input.send")
            }
            title={
              settings.enableMultiMessageQueue
                ? t("chat_input.send_long_press")
                : t("chat_input.send")
            }
            className={`chat-send-button size-[38px] rounded-xl bg-primary text-primary-foreground transition-[background-color,box-shadow,transform] duration-200 flex items-center justify-center shrink-0 active:scale-95 ${canSend
                ? "hover:bg-primary/90 hover:-translate-y-0.5 cursor-pointer opacity-100"
                : "opacity-45 cursor-not-allowed bg-muted text-muted-foreground shadow-none"
              }`}
          >
            <Send className={`w-3.5 h-3.5 transition-transform duration-300 ${canSend ? "scale-110" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      <QuickActionManagerModal
        open={quickActionManagerOpen}
        onClose={() => setQuickActionManagerOpen(false)}
        quickActionsVisible={showQuickActions}
        onToggleQuickActionsVisible={(nextVisible) => {
          setShowQuickActions(nextVisible);
          try {
            localStorage.setItem(QUICK_ACTIONS_STORAGE_KEY, String(nextVisible));
          } catch {}
        }}
        modulesConfig={quickActionModules}
        onUpdateModulesConfig={handleUpdateQuickActionModules}
      />
    </div>
  );
};

export default ChatInputArea;
