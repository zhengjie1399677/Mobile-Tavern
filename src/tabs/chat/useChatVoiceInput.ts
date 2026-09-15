import React from "react";
import type { UserSettings } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  KernelServices,
  type IKernelService,
  type IAsrService,
  type IAgentRuntimeService,
  type IAttachmentService,
  type IVoiceCaptureService,
} from "@/src/application/serviceContracts";
import { resolveBuiltinProviderId } from "@/src/application/runtimePlugins/agentSpineRuntimePlugin";
import type { PendingAttachment } from "./attachment-composer/PendingAttachmentStrip";

interface UseChatVoiceInputOptions {
  activeSessionId?: string;
  settings: UserSettings;
  localInput: string;
  setLocalInput: (val: string) => void;
  setUserInputMessage: (val: string) => void;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
  getKernelService: <T extends IKernelService>(name: string) => T;
  showCustomAlert: (msg: string, title?: string) => Promise<void> | void;
}

export function useChatVoiceInput({
  activeSessionId,
  settings,
  localInput,
  setLocalInput,
  setUserInputMessage,
  pendingAttachments,
  setPendingAttachments,
  getKernelService,
  showCustomAlert,
}: UseChatVoiceInputOptions) {
  const { t } = useTranslation();
  const [isAsrRecording, setIsAsrRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [isModelVoiceRecording, setIsModelVoiceRecording] = React.useState(false);
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
    setIsModelVoiceRecording(false);
    modelVoiceCaptureTokenRef.current += 1;
    modelVoiceFinalizingRef.current = false;
    try {
      void getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture).cancelCapture();
    } catch {
      // 旧测试容器或降级组合根可能尚未注册该可选服务。
    }
  }, [activeSessionId, getKernelService]);

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
              void showCustomAlert(
                t("chat_input.asr_permission_msg"),
                t("chat_input.asr_permission_denied")
              );
            } else if (errMsg.includes("no-speech")) {
              void showCustomAlert(t("chat_input.asr_no_speech_msg"), t("chat_input.asr_no_speech"));
            } else if (errMsg.includes("audio-capture")) {
              void showCustomAlert(t("chat_input.asr_device_error_msg", { error: errMsg }), t("chat_input.asr_device_error"));
            } else {
              void showCustomAlert(t("chat_input.asr_error_msg", { error: errMsg }), t("chat_input.asr_error"));
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

  return {
    isAsrRecording,
    isTranscribing,
    isModelVoiceRecording,
    supportsNativeAudioInput,
    handleToggleAsr,
    handleToggleModelVoice,
  };
}
