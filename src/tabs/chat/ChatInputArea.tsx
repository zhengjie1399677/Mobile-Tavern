// 输入区子组件（含建议词、长按、键盘联动）
// 从原 ChatTab.tsx L39-470 抽离
// 通过 useUnifiedApp 选择器读取所需状态，接收 isKeyboardOpen 作为 prop

import React from "react";
import {
  Send,
  RefreshCw,
  Cpu,
  Square,
  Mic,
  Loader2,
  Play,
  AudioWaveform,
} from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { useTranslation } from "../../contexts/LanguageContext";
import { chatTabState } from "./utils";
import type { ChatSession, CustomPromptBlock, Message, ReplyChoice, SummaryCard } from "../../types";
import {
  KernelServices,
  type IAsrService,
  type IAgentRuntimeService,
  type IAttachmentService,
  type ICompatibilityRuntimeService,
  type IToolPluginRuntimeService,
  type IVoiceCaptureService,
} from "@/src/application/serviceContracts";
import { resolveBuiltinProviderId } from "@/src/application/runtimePlugins/agentSpineRuntimePlugin";
import { getSessionRuntimeProfileId } from "@/src/application/useCases/runtimeProfileSession";
import {
  filterComposerCommandSuggestions,
  resolveComposerCommandInvocation,
} from "@/src/application/useCases/composerCommandUseCases";
import type { ToolPluginComposerCommand } from "@/src/domain/toolPlugins";
import type { RecalledMessage } from "@/src/application/services/memory/types";
import type { AttachmentMetadata } from "../../domain/attachments/types";
import type { MessageContentPart } from "../../domain/messages/messageContent";
import { AttachmentPicker } from "./attachment-composer/AttachmentPicker";
import {
  PendingAttachmentStrip,
  type PendingAttachment,
} from "./attachment-composer/PendingAttachmentStrip";

/**
 * 用于在事件 currentTarget 上标记 _touched 状态，
 * 以区分 touchstart 与 mousedown 事件，避免移动端重复触发。
 */
type TouchTrackedElement = Element & { _touched?: boolean };

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

const ChatInputArea = ({ isKeyboardOpen }: { isKeyboardOpen: boolean }) => {
  const [showQuickActions, setShowQuickActions] = React.useState(false);
  const { t } = useTranslation();
  const {
    isSending,
    setIsSending,
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
    replySuggestions,
    setReplySuggestions,
    updateSettings,
    isBisonLocking,
    lastRecalledMemories,
    triggerScroll,
    getKernelService,
    messageHydrationStatus,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    setIsSending: state.setIsSending,
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
    replySuggestions: state.replySuggestions,
    setReplySuggestions: state.setReplySuggestions,
    updateSettings: state.updateSettings,
    isBisonLocking: state.isBisonLocking,
    lastRecalledMemories: state.lastRecalledMemories,
    triggerScroll: state.triggerScroll,
    getKernelService: state.getKernelService,
    messageHydrationStatus: state.messageHydrationStatus,
  }));
  const compatibilityVariables = activeSession
    ? getKernelService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
      .readState(activeSession)
    : {};


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

  // 优先从全局闭包变量中读取以抗御组件销毁重装，否则继承 settings
  const [clickMode, setClickMode] = React.useState<"send" | "fill">(
    chatTabState.suggestionsClickMode || settings.replySuggestionsClickMode || "fill"
  );
  // Ref 始终同步最新 clickMode，供事件处理函数使用，彻底避免陈旧闭包
  const clickModeRef = React.useRef<"send" | "fill">(clickMode);
  React.useEffect(() => {
    clickModeRef.current = clickMode;
  }, [clickMode]);

  React.useEffect(() => {
    if (settings.replySuggestionsClickMode) {
      if (chatTabState.suggestionsClickMode !== settings.replySuggestionsClickMode) {
        chatTabState.suggestionsClickMode = settings.replySuggestionsClickMode;
        setClickMode(settings.replySuggestionsClickMode);
      }
    }
  }, [settings.replySuggestionsClickMode]);

  const [localInput, setLocalInput] = React.useState(userInputMessage);

  const [isAsrRecording, setIsAsrRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [isModelVoiceRecording, setIsModelVoiceRecording] = React.useState(false);
  const [isExecutingComposerCommand, setIsExecutingComposerCommand] = React.useState(false);
  const [pendingAttachments, setPendingAttachments] = React.useState<PendingAttachment[]>([]);
  const modelVoiceFinalizingRef = React.useRef(false);
  const modelVoiceCaptureTokenRef = React.useRef(0);

  const supportsNativeAudioInput = React.useMemo(() => {
    if (settings.api.supportsAudioInput !== true) return false;
    try {
      const runtime = getKernelService<IAgentRuntimeService>(KernelServices.AgentRuntime);
      return runtime
        .getProvider(resolveBuiltinProviderId(settings.api.type))
        .capabilities.inputModalities.includes("audio");
    } catch {
      return false;
    }
  }, [getKernelService, settings.api.supportsAudioInput, settings.api.type]);

  React.useEffect(() => {
    setPendingAttachments([]);
    setIsModelVoiceRecording(false);
    modelVoiceCaptureTokenRef.current += 1;
    modelVoiceFinalizingRef.current = false;
    try {
      void getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture).cancelCapture();
    } catch {
      // 旧测试容器或降级组合根可能尚未注册该可选服务。
    }
  }, [activeSession?.id, getKernelService]);

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

  const handleToggleAsr = async () => {
    try {
      const asrService = getKernelService<IAsrService>("asr");
      if (isAsrRecording) {
        setIsAsrRecording(false);
        if (settings.asrConfig?.provider === "openai") {
          setIsTranscribing(true);
        }
        asrService.stopListening();
      } else {
        setIsAsrRecording(true);
        setIsTranscribing(false);
        let initialText = localInput;

        await asrService.startListening(
          settings.asrConfig || {
            enabled: true,
            provider: "web-speech",
            language: "zh-CN",
          },
          (text: string, isFinal: boolean) => {
            if (settings.asrConfig?.provider === "web-speech") {
              const newText = initialText ? `${initialText} ${text}` : text;
              setLocalInput(newText);
              setUserInputMessage(newText);
              if (isFinal) {
                initialText = newText;
              }
            } else {
              const newText = localInput ? `${localInput} ${text}` : text;
              setLocalInput(newText);
              setUserInputMessage(newText);
            }
          },
          (err: unknown) => {
            console.error("ASR Error:", err);
            setIsAsrRecording(false);
            setIsTranscribing(false);

            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes("not-allowed") || errMsg.includes("Permission denied") || errMsg.includes("NotAllowedError") || errMsg.includes("permission denied")) {
              showCustomAlert(
                t("chat_input.asr_permission_msg"),
                t("chat_input.asr_permission_denied")
              );
            } else if (errMsg.includes("no-speech")) {
              showCustomAlert(t("chat_input.asr_no_speech_msg"), t("chat_input.asr_no_speech"));
            } else if (errMsg.includes("audio-capture")) {
              showCustomAlert(t("chat_input.asr_device_error_msg", { error: errMsg }), t("chat_input.asr_device_error"));
            } else {
              showCustomAlert(t("chat_input.asr_error_msg", { error: errMsg }), t("chat_input.asr_error"));
            }
          },
          () => {
            setIsAsrRecording(false);
            setIsTranscribing(false);
          }
        );
      }
    } catch (e) {
      console.error("ASR Toggle Error:", e);
      setIsAsrRecording(false);
      setIsTranscribing(false);
    }
  };

  const finishModelVoiceCapture = React.useCallback(async (captureToken?: number) => {
    const token = captureToken ?? modelVoiceCaptureTokenRef.current;
    if (token !== modelVoiceCaptureTokenRef.current || modelVoiceFinalizingRef.current) return;
    modelVoiceFinalizingRef.current = true;
    const capture = getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture);
    try {
      const file = await capture.stopCapture();
      const attachments = getKernelService<IAttachmentService>(KernelServices.Attachments);
      const metadata = await attachments.stageFile(file);
      const previewUrl = await attachments.getObjectUrl(metadata.id);
      setPendingAttachments((current) => [
        ...current,
        { metadata, previewUrl, purpose: "model-input" },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "VOICE_CAPTURE_NOT_ACTIVE") {
        await showCustomAlert(`语音录制失败：${message}`);
      }
    } finally {
      if (token === modelVoiceCaptureTokenRef.current) setIsModelVoiceRecording(false);
      modelVoiceFinalizingRef.current = false;
    }
  }, [getKernelService, setIsModelVoiceRecording, setPendingAttachments, showCustomAlert]);

  const handleToggleModelVoice = React.useCallback(async () => {
    if (isModelVoiceRecording) {
      await finishModelVoiceCapture();
      return;
    }
    if (pendingAttachments.length >= 4) {
      await showCustomAlert("每条消息最多添加 4 个附件。");
      return;
    }
    try {
      const capture = getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture);
      const captureToken = modelVoiceCaptureTokenRef.current + 1;
      modelVoiceCaptureTokenRef.current = captureToken;
      await capture.startCapture({
        maxDurationMs: 60_000,
        onLimitReached: () => { void finishModelVoiceCapture(captureToken); },
      });
      setIsModelVoiceRecording(true);
    } catch (error) {
      setIsModelVoiceRecording(false);
      const message = error instanceof Error ? error.message : String(error);
      if (/NotAllowedError|not-allowed|permission/i.test(message)) {
        await showCustomAlert("需要麦克风权限，才能录制给模型直接理解的语音。");
      } else {
        await showCustomAlert(`无法开始语音录制：${message}`);
      }
    }
  }, [finishModelVoiceCapture, getKernelService, isModelVoiceRecording, pendingAttachments.length, showCustomAlert]);

  React.useEffect(() => {
    setLocalInput(userInputMessage);
  }, [userInputMessage]);

  const localInputRef = React.useRef(localInput);
  React.useEffect(() => {
    localInputRef.current = localInput;
  }, [localInput]);

  React.useEffect(() => {
    return () => {
      setUserInputMessage(localInputRef.current);
    };
  }, [activeSession?.id]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(38, Math.min(textarea.scrollHeight, 160))}px`;

    // 用户在输入长文本换行导致输入框高度改变时，若软键盘处于打开状态且聚焦，通过滚动消息历史确保最新可见，不顶起整个视口
    if (isKeyboardOpen && document.activeElement === textarea) {
      triggerScroll("auto");
    }
  }, [localInput, isKeyboardOpen, triggerScroll]);

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
  }, [isKeyboardOpen, triggerScroll]);

  const lastMsgIsUser = React.useMemo(() => {
    if (!activeSession || !Array.isArray(activeSession.messages) || activeSession.messages.length === 0) return false;
    return activeSession.messages[activeSession.messages.length - 1].sender === "user";
  }, [activeSession]);

  const composerProfileId = React.useMemo(
    () => getSessionRuntimeProfileId(activeSession),
    [activeSession],
  );
  const composerCommands = React.useMemo<ToolPluginComposerCommand[]>(() => {
    if (!composerProfileId) return [];
    try {
      return getKernelService<IToolPluginRuntimeService>(KernelServices.ToolConnectors)
        .listComposerCommands(composerProfileId);
    } catch {
      // Tool Plugin Runtime 是可降级服务；缺失时输入框维持普通文本行为。
      return [];
    }
  }, [composerProfileId, getKernelService]);
  const composerCommandSuggestions = filterComposerCommandSuggestions(localInput, composerCommands);

  const executeComposerCommand = React.useCallback(async (
    command: ToolPluginComposerCommand,
    argument: string,
  ): Promise<void> => {
    if (!activeSession || !composerProfileId || isExecutingComposerCommand) return;
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
      const result = await getKernelService<IToolPluginRuntimeService>(KernelServices.ToolConnectors)
        .executeComposerCommand({
          profileId: composerProfileId,
          sessionId: activeSession.id,
          name: command.name,
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
    composerProfileId,
    getKernelService,
    isExecutingComposerCommand,
    setLocalInput,
    setReplySuggestions,
    setUserInputMessage,
    showCustomAlert,
  ]);

  const executeComposerCommandIfPresent = React.useCallback(async (): Promise<boolean> => {
    const invocation = resolveComposerCommandInvocation(localInput, composerCommands);
    if (!invocation) return false;
    await executeComposerCommand(invocation.command, invocation.argument);
    return true;
  }, [composerCommands, executeComposerCommand, localInput]);

  const canSend = React.useMemo(() => {
    if (!activeSession || messageHydrationStatus !== "ready" || isModelVoiceRecording || isExecutingComposerCommand) return false;
    const hasInput = (localInput || "").trim() !== "";
    const hasAttachments = pendingAttachments.length > 0;
    if (settings.enableMultiMessageQueue) {
      return hasInput || hasAttachments || lastMsgIsUser;
    }
    return hasInput || hasAttachments;
  }, [activeSession, isExecutingComposerCommand, isModelVoiceRecording, localInput, messageHydrationStatus, pendingAttachments.length, settings.enableMultiMessageQueue, lastMsgIsUser]);

  const onSendPure = React.useCallback(async () => {
    if (!localInput.trim() && pendingAttachments.length === 0) return;
    if (await executeComposerCommandIfPresent()) return;
    const msg = localInput;
    try {
      await handleSendMessage(msg, {
        skipAI: true,
        attachmentIds: pendingAttachments.map(item => item.metadata.id),
        attachmentParts: pendingAttachments.map(toMessageAttachmentPart),
      });
    } catch {
      return;
    }
    setPendingAttachments([]);
    setLocalInput("");
    setUserInputMessage("");
    setReplySuggestions([]);
  }, [
    localInput,
    pendingAttachments,
    executeComposerCommandIfPresent,
    handleSendMessage,
    setLocalInput,
    setPendingAttachments,
    setReplySuggestions,
    setUserInputMessage,
  ]);

  const onSendMerged = React.useCallback(async () => {
    if (await executeComposerCommandIfPresent()) return;
    const msg = localInput.trim();
    try {
      await handleSendMessage(msg, {
        skipAI: false,
        attachmentIds: pendingAttachments.map(item => item.metadata.id),
        attachmentParts: pendingAttachments.map(toMessageAttachmentPart),
      });
    } catch {
      return;
    }
    setPendingAttachments([]);
    setLocalInput("");
    setUserInputMessage("");
    setReplySuggestions([]);
  }, [
    localInput,
    pendingAttachments,
    executeComposerCommandIfPresent,
    handleSendMessage,
    setLocalInput,
    setPendingAttachments,
    setReplySuggestions,
    setUserInputMessage,
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

  const handlePointerUp = React.useCallback((e: React.PointerEvent) => {
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

  const handleSelectSuggestion = (e: React.MouseEvent | React.TouchEvent, suggestion: ReplyChoice) => {
    if (e && e.cancelable) {
      e.preventDefault();
    }
    if (e.type === "touchstart") {
      (e.currentTarget as TouchTrackedElement)._touched = true;
    } else if (e.type === "mousedown") {
      if ((e.currentTarget as TouchTrackedElement)._touched) {
        (e.currentTarget as TouchTrackedElement)._touched = false;
        return;
      }
    }

    // 优先读取同步更新的全局变量，再降级到 Ref，彻底消除 React 调度时序导致的陈旧读取
    const currentMode = chatTabState.suggestionsClickMode ?? clickModeRef.current;
    if (currentMode === "send") {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions([]);
        handleSendMessage(suggestion.prompt);
      } else {
        setLocalInput(suggestion.prompt);
        setUserInputMessage(suggestion.prompt);
    }
  };

  return (
    <div
      id="chat-input-area-container"
      ref={containerRef}
      style={{
        paddingBottom: `${isKeyboardOpen ? 4 : Math.max(safeAreas?.bottom ?? 0, 10)}px`
      }}
      className="chat-composer-shell z-10 flex shrink-0 flex-col items-center gap-2 px-3 pt-2.5"
    >
      {showQuickActions && (
        <div className="chat-composer-popover flex w-full max-w-3xl items-center justify-between rounded-xl px-2 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleRerollLast()}
              disabled={
                isSending ||
                !activeSession ||
                !Array.isArray(activeSession.messages) ||
                !activeSession.messages.some((m: Message) => m.sender === "assistant")
              }
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
              title="消除整条故事分支的最后一条AI回复并进行重新生成"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isSending ? "animate-spin" : ""}`}
              />
              <span className="text-xs font-medium">{t("chat_input.reroll_last")}</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage(t("chat_input.continue"))}
              disabled={isSending || !activeSession}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary disabled:opacity-40"
              title={`替用户发送"继续"以继续当前剧情`}
            >
              <Play className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t("chat_input.continue")}</span>
            </button>
          </div>

          <div
            aria-hidden="true"
            className="flex items-center gap-1.5 pr-1 text-muted-foreground font-mono text-[9px] opacity-75"
          >
            <Cpu className="w-3 h-3" />
            <span>
              {t("chat_input.token_prediction")} ~
              {Math.ceil(
                (localInput || "").length * 1.5 +
                ((Array.isArray(activeSession?.messages)
                  ? activeSession.messages.slice(-settings.memory.recentTurns)
                  : []
                ).reduce(
                  (acc: number, m: Message) => acc + (m.content || "").length,
                  0,
                ) || 0) *
                1.5 +
                ((activeCharacter?.description || "").length +
                  (activeCharacter?.personality || "").length +
                  (activeCharacter?.scenario || "").length +
                  (activeCharacter?.system_prompt || "").length) *
                1.5 +
                (settings.promptConfig?.customPrompts || [])
                  .filter((p: CustomPromptBlock) => p.enabled)
                  .reduce(
                    (acc: number, p: CustomPromptBlock) => acc + (p.content || "").length,
                    0,
                  ) *
                1.5 +
                (activeSession?.summaries || []).reduce(
                  (acc: number, s: SummaryCard) => acc + (s.content || "").length,
                  0,
                ) *
                1.5 +
                (settings.memory?.enableRecall !== false && lastRecalledMemories || []).reduce(
                  (acc: number, m: RecalledMessage) => acc + (m.content || "").length,
                  0,
                ) *
                1.5 +
                (settings.enableScriptExecution &&
                  (() => {
                    const ext = activeCharacter?.extensions || {};
                    return (
                      (Array.isArray(ext.tavern_helper?.scripts) && ext.tavern_helper.scripts.length > 0) ||
                      !!(ext.mvu_settings || ext.mvu || ext.MVU)
                    );
                  })() &&
                  Object.keys(compatibilityVariables).length > 0
                  ? JSON.stringify(compatibilityVariables).length
                  : 0) *
                1.5,
              )}{" "}
              tok
            </span>
          </div>
        </div>
      )}
      {settings.enableReplySuggestions && !isSending && composerCommandSuggestions.length === 0 && replySuggestions && replySuggestions.length > 0 && (
        <div className="chat-composer-popover flex w-full max-w-3xl flex-col gap-1.5 rounded-2xl p-2 animate-fadeIn">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium px-1">
            <span className="flex items-center gap-1">{t("chat_input.suggestions_label")}</span>
            <button
              onClick={() => {
                const nextMode = clickMode === "send" ? "fill" : "send";
                // 同步更新全局变量与 Ref，确保 handleSelectSuggestion 在本次事件循环内即可读到最新值
                chatTabState.suggestionsClickMode = nextMode;
                clickModeRef.current = nextMode;
                setClickMode(nextMode);
                updateSettings((prev) => ({
                  ...prev,
                  replySuggestionsClickMode: nextMode,
                }));
              }}
              className="flex min-h-11 items-center gap-1 rounded border border-border bg-muted px-2 text-xs font-semibold transition hover:bg-muted/80 active:scale-95"
            >
              {t("chat_input.click_mode", { mode: clickMode === "send" ? t("chat_input.click_mode_send") : t("chat_input.click_mode_fill") })}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5 py-1.5 px-0.5">
            {replySuggestions.map((suggestion, idx) => (
              <button
                key={suggestion.id || idx}
                onMouseDown={(e) => handleSelectSuggestion(e, suggestion)}
                onTouchStart={(e) => handleSelectSuggestion(e, suggestion)}
                onClick={(e) => {
                  e.preventDefault();
                }}
                className="min-h-11 w-full rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-left text-xs font-normal leading-normal text-foreground shadow-sm transition hover:border-primary/30 hover:bg-primary/10 active:scale-95"
                title={suggestion.description || suggestion.prompt}
              >
                <span className="block truncate font-medium">{suggestion.label}</span>
                {suggestion.description && (
                  <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{suggestion.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {!isSending && composerCommandSuggestions.length > 0 && (
        <div className="chat-composer-popover flex w-full max-w-3xl flex-col gap-1 rounded-2xl p-2 animate-fadeIn">
          <div className="px-1 text-xs font-medium text-muted-foreground">输入框命令</div>
          {composerCommandSuggestions.map((command) => (
            <button
              key={`${command.pluginId}:${command.name}`}
              type="button"
              disabled={isExecutingComposerCommand}
              onClick={() => {
                if (command.acceptsArgument) {
                  const nextInput = `/${command.name} `;
                  setLocalInput(nextInput);
                  setUserInputMessage(nextInput);
                  requestAnimationFrame(() => textareaRef.current?.focus());
                } else {
                  void executeComposerCommand(command, "");
                }
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-primary/10 active:scale-[0.99] disabled:opacity-50"
            >
              <span className="shrink-0 font-mono text-sm font-semibold text-primary">/{command.name}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{command.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{command.description}</span>
              </span>
              {isExecutingComposerCommand && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      <PendingAttachmentStrip
        items={pendingAttachments}
        maxCount={4}
        onRemove={(assetId) => setPendingAttachments((current) => (
          current.filter((candidate) => candidate.metadata.id !== assetId)
        ))}
      />
      <div className="chat-composer-row relative flex w-full max-w-3xl items-end gap-1 rounded-2xl p-1">
        <AttachmentPicker
          disabled={isSending || isBisonLocking || isModelVoiceRecording}
          selectedCount={pendingAttachments.length}
          maxCount={4}
          quickActionsVisible={showQuickActions}
          onSelect={handleSelectAttachments}
          onToggleQuickActions={() => setShowQuickActions((current) => !current)}
        />
        <textarea
          ref={textareaRef}
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onKeyDown={(e) => {
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
                : isModelVoiceRecording
                  ? "正在录制给模型的语音…"
                : isAsrRecording
                ? t("chat_input.placeholder_recording")
                : isTranscribing
                  ? t("chat_input.placeholder_transcribing")
                  : t("chat_input.placeholder_default", { name: activeCharacter?.name || "" })
          }
          aria-label={t("chat_input.aria_label", { name: activeCharacter?.name || "角色" })}
          rows={1}
          className={`chat-composer-input min-h-[38px] max-h-[160px] flex-1 resize-none overflow-y-auto rounded-xl bg-transparent px-2.5 py-[9px] text-sm font-normal leading-5 text-foreground placeholder:text-muted-foreground/55 focus:outline-none ${(isBisonLocking || isSending) ? "opacity-50 cursor-not-allowed text-muted-foreground" : ""
            }`}
        />
        {supportsNativeAudioInput && (
          <button
            type="button"
            aria-label={isModelVoiceRecording ? "停止模型语音录制" : "录制模型语音输入"}
            onClick={() => { void handleToggleModelVoice(); }}
            disabled={isSending || isBisonLocking || isAsrRecording || isTranscribing}
            className={`flex size-[38px] shrink-0 items-center justify-center rounded-xl border transition-colors ${isModelVoiceRecording
              ? "border-red-500/40 bg-red-500/15 text-red-500 animate-pulse"
              : "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
            } ${(isSending || isBisonLocking || isAsrRecording || isTranscribing) ? "cursor-not-allowed opacity-45" : "active:scale-95"}`}
            title={isModelVoiceRecording ? "停止并附加这段语音" : "让当前模型直接听这段语音"}
          >
            <AudioWaveform className="size-4" aria-hidden="true" />
          </button>
        )}
        {settings.asrConfig?.enabled && (
          <button
            type="button"
            aria-label={isAsrRecording ? t("chat_input.asr_stop") : isTranscribing ? t("chat_input.asr_recognizing") : t("chat_input.asr_mic")}
            onClick={handleToggleAsr}
            disabled={isSending || isBisonLocking || isModelVoiceRecording}
            className={`size-[38px] rounded-xl border transition-colors duration-200 shrink-0 flex items-center justify-center ${isAsrRecording
                ? "bg-red-500/20 border-red-500/40 text-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                : isTranscribing
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-500"
                  : "bg-input/30 border-border/80 text-muted-foreground hover:bg-muted"
              } ${(isSending || isBisonLocking || isModelVoiceRecording) ? "opacity-45 cursor-not-allowed" : "active:scale-95"}`}
            title={isAsrRecording ? t("chat_input.asr_stop") : isTranscribing ? t("chat_input.asr_transcribing") : t("chat_input.asr_mic")}
          >
            {isTranscribing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isAsrRecording ? (
              <Mic className="w-4 h-4 animate-bounce" />
            ) : (
              <Mic className="w-4 h-4 opacity-70" />
            )}
          </button>
        )}
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
    </div>
  );
};

export default ChatInputArea;
