import React from "react";
import {
  KernelServices,
  type IKernelService,
  type IAttachmentService,
  type IVoiceCaptureService,
} from "@/src/application/serviceContracts";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PendingAttachment } from "./attachment-composer/PendingAttachmentStrip";

interface UseChatVoiceInputOptions {
  activeSessionId?: string;
  pendingAttachments: PendingAttachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
  getKernelService: <T extends IKernelService>(name: string) => T;
  showCustomAlert: (msg: string, title?: string) => Promise<void> | void;
  /** 松手发送与到达上限自动发送共用的发送回调（由输入区提供，内部用 latest-ref 持有）。 */
  sendVoiceMessage: (attachment: PendingAttachment) => Promise<void>;
}

const VOICE_MAX_DURATION_MS = 180_000;
/** 接近上限时遮罩转警示色并预告自动发送，避免句子被无声截断。 */
const VOICE_LIMIT_WARNING_MS = 165_000;
const MIN_HOLD_MS = 500;
const MAX_PENDING_ATTACHMENTS = 4;
/**
 * 微信式取消：手指需要持续上滑一段距离才会进入取消态，而不是刚离开按钮就取消。
 * 阈值按视口高度计算（约六分之一屏），避免固定像素在不同尺寸手机上体感差异过大；
 * 进入与退出使用不同阈值（滞回），避免手指在边界抖动时红/绿状态反复跳变。
 */
const CANCEL_SWIPE_VIEWPORT_RATIO = 1 / 5;
const CANCEL_SWIPE_MIN_THRESHOLD_PX = 100;
const CANCEL_SWIPE_DISARM_RATIO = 0.75;
const AMPLITUDE_POLL_INTERVAL_MS = 100;
/** 进度只按 5% 步进提交，避免 pointermove 高频 setState 拖慢 WebView。 */
const CANCEL_PROGRESS_STEPS = 20;

const VOICE_ERROR_KEYS: Record<string, string> = {
  VOICE_CAPTURE_PERMISSION_DENIED: "chat_input.voice_error_permission",
  VOICE_CAPTURE_PERMISSION_BLOCKED: "chat_input.voice_error_permission_blocked",
  VOICE_CAPTURE_EMPTY: "chat_input.voice_error_empty",
  VOICE_CAPTURE_TOO_LARGE: "chat_input.voice_error_too_large",
  VOICE_CAPTURE_UNAVAILABLE: "chat_input.voice_error_unavailable",
};

function resolveVoiceErrorKey(message: string): string {
  const known = VOICE_ERROR_KEYS[message];
  if (known) return known;
  // Web Audio 回退链路的浏览器权限异常
  if (/NotAllowedError|not-allowed|permission/i.test(message)) return "chat_input.voice_error_permission";
  return "chat_input.voice_error_generic";
}

/** 每次按住时按当前视口高度取阈值，旋转屏幕或分屏后仍然保持「约六分之一屏」的体感。 */
function resolveCancelSwipeThresholds(): { arm: number; disarm: number } {
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const arm = Math.max(CANCEL_SWIPE_MIN_THRESHOLD_PX, viewportHeight * CANCEL_SWIPE_VIEWPORT_RATIO);
  return { arm, disarm: arm * CANCEL_SWIPE_DISARM_RATIO };
}

/**
 * 微信式「按住说话」输入：采集、波形、上滑取消，以及**松手发送与到点自动发送的唯一收尾路径**。
 *
 * 陈旧性守卫是一个三元组，缺一不可（删除静默吞掉 `VOICE_CAPTURE_NOT_ACTIVE` 的前提）：
 * 1. `holdActiveRef` 早退：到点自动发送后用户再松手，不会重复发送；
 * 2. 收尾前后各校验一次 `modelVoiceCaptureTokenRef`：切会话 / 取消 / 新一次按住都会作废在途回调；
 * 3. 启动失败时只在 token 仍属自己时才复位状态，避免误伤紧接着的下一次按住。
 */
export function useChatVoiceInput({
  activeSessionId,
  pendingAttachments,
  setPendingAttachments,
  getKernelService,
  showCustomAlert,
  sendVoiceMessage,
}: UseChatVoiceInputOptions) {
  const { t } = useTranslation();
  // 微信式语音模式开关（键盘 vs 按住说话）
  const [isVoiceMode, setIsVoiceMode] = React.useState(false);
  // 按住状态与交互状态
  const [isHolding, setIsHolding] = React.useState(false);
  const [isCancelHovered, setIsCancelHovered] = React.useState(false);
  const [cancelSwipeProgress, setCancelSwipeProgress] = React.useState(0);
  const [holdDurationMs, setHoldDurationMs] = React.useState(0);
  const [voiceAmplitude, setVoiceAmplitude] = React.useState(0);

  const holdStartTimeRef = React.useRef(0);
  /** 同步真值：`isHolding` 是渲染期事实，跨 await 不可靠（松手可能早于 startCapture 落地）。 */
  const holdActiveRef = React.useRef(false);
  const voiceStartYRef = React.useRef(0);
  /** 取消态同步真值：松手时不能依赖 pointermove 的 setState 是否已提交。 */
  const cancelArmedRef = React.useRef(false);
  const cancelSwipeThresholdRef = React.useRef(resolveCancelSwipeThresholds());
  const activePointerIdRef = React.useRef<number | null>(null);
  /** 在途的 startCapture：松手若早于它完成，收尾必须先等它落地。 */
  const startPromiseRef = React.useRef<Promise<unknown> | null>(null);
  const modelVoiceCaptureTokenRef = React.useRef(0);

  const sendRef = React.useRef(sendVoiceMessage);
  React.useEffect(() => {
    sendRef.current = sendVoiceMessage;
  }, [sendVoiceMessage]);

  const resetHoldState = React.useCallback(() => {
    holdActiveRef.current = false;
    holdStartTimeRef.current = 0;
    cancelArmedRef.current = false;
    activePointerIdRef.current = null;
    setIsHolding(false);
    setIsCancelHovered(false);
    setCancelSwipeProgress(0);
    setHoldDurationMs(0);
    setVoiceAmplitude(0);
  }, []);

  const cancelHoldRecord = React.useCallback(async () => {
    modelVoiceCaptureTokenRef.current += 1;
    resetHoldState();
    try {
      await getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture).cancelCapture();
    } catch {
      // 降级容器容错
    }
  }, [getKernelService, resetHoldState]);

  const finishHoldRecord = React.useCallback(async (source: "release" | "limit"): Promise<void> => {
    if (!holdActiveRef.current) return;
    const token = modelVoiceCaptureTokenRef.current;
    const duration = Date.now() - holdStartTimeRef.current;
    resetHoldState();

    let capture: IVoiceCaptureService;
    let attachments: IAttachmentService;
    try {
      capture = getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture);
      attachments = getKernelService<IAttachmentService>(KernelServices.Attachments);
    } catch {
      return;
    }

    // 短按判定为误触：到点自动发送不适用（三分钟的录音不可能太短）。
    if (source === "release" && duration < MIN_HOLD_MS) {
      try {
        await capture.cancelCapture();
      } catch {}
      await showCustomAlert(t("chat_input.voice_too_short"));
      return;
    }

    try {
      // 松手早于启动落地时，先等 startCapture 完成再停止，否则会撞上 NOT_ACTIVE。
      await startPromiseRef.current;
      const file = await capture.stopCapture();
      if (token !== modelVoiceCaptureTokenRef.current) return;
      const metadata = await attachments.stageFile(file);
      if (token !== modelVoiceCaptureTokenRef.current) return;
      const pending: PendingAttachment = {
        metadata,
        previewUrl: await attachments.getObjectUrl(metadata.id),
        purpose: "model-input",
      };
      setPendingAttachments((current) => [...current, pending]);
      await sendRef.current(pending);
    } catch (error) {
      if (token !== modelVoiceCaptureTokenRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "VOICE_CAPTURE_SUPERSEDED") return;
      console.error("[voice] capture finalize failed:", message);
      await showCustomAlert(t(resolveVoiceErrorKey(message)));
    }
  }, [getKernelService, resetHoldState, setPendingAttachments, showCustomAlert, t]);

  // 上限回调可能在多次渲染之后触发，用 latest-ref 取到最新的收尾实现。
  const finishHoldRecordRef = React.useRef(finishHoldRecord);
  React.useEffect(() => {
    finishHoldRecordRef.current = finishHoldRecord;
  }, [finishHoldRecord]);

  const startHoldRecord = React.useCallback(async (): Promise<boolean> => {
    if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
      await showCustomAlert("每条消息最多添加 4 个附件。");
      resetHoldState();
      return false;
    }
    let capture: IVoiceCaptureService;
    try {
      capture = getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture);
    } catch {
      resetHoldState();
      return false;
    }

    const token = modelVoiceCaptureTokenRef.current + 1;
    modelVoiceCaptureTokenRef.current = token;
    holdActiveRef.current = true;
    holdStartTimeRef.current = Date.now();
    cancelArmedRef.current = false;
    setIsHolding(true);
    setIsCancelHovered(false);
    setCancelSwipeProgress(0);
    setHoldDurationMs(0);
    setVoiceAmplitude(0);

    const started = capture.startCapture({
      maxDurationMs: VOICE_MAX_DURATION_MS,
      onLimitReached: () => {
        if (token !== modelVoiceCaptureTokenRef.current) return;
        void finishHoldRecordRef.current("limit");
      },
    });
    startPromiseRef.current = started;

    try {
      await started;
      if (token !== modelVoiceCaptureTokenRef.current) {
        // 启动期间已被取消或切换会话
        try {
          await capture.cancelCapture();
        } catch {}
        return false;
      }
      return true;
    } catch (error) {
      if (token === modelVoiceCaptureTokenRef.current) {
        modelVoiceCaptureTokenRef.current += 1;
        resetHoldState();
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === "VOICE_CAPTURE_SUPERSEDED") return false;
      console.error("[voice] capture start failed:", message);
      await showCustomAlert(t(resolveVoiceErrorKey(message)));
      return false;
    } finally {
      if (startPromiseRef.current === started) startPromiseRef.current = null;
    }
  }, [getKernelService, pendingAttachments.length, resetHoldState, showCustomAlert, t]);

  // 会话切换时重置录音状态并安全取消
  React.useEffect(() => {
    resetHoldState();
    modelVoiceCaptureTokenRef.current += 1;
    try {
      void getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture).cancelCapture();
    } catch {
      // 降级容器容错
    }
  }, [activeSessionId, getKernelService, resetHoldState]);

  // 组件卸载时安全释放麦克风
  React.useEffect(() => {
    return () => {
      holdActiveRef.current = false;
      modelVoiceCaptureTokenRef.current += 1;
      try {
        void getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture).cancelCapture();
      } catch {}
    };
  }, [getKernelService]);

  // 时长与振幅轮询：keyed on isHolding，结构上不可能被 async 体里的提前 return 搁浅。
  React.useEffect(() => {
    if (!isHolding) return undefined;
    let capture: IVoiceCaptureService | null = null;
    try {
      capture = getKernelService<IVoiceCaptureService>(KernelServices.VoiceCapture);
    } catch {
      return undefined;
    }
    const tick = () => {
      if (holdStartTimeRef.current > 0) {
        setHoldDurationMs(Date.now() - holdStartTimeRef.current);
      }
      setVoiceAmplitude(capture?.getAmplitude?.() ?? 0);
    };
    tick();
    const timer = setInterval(tick, AMPLITUDE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [getKernelService, isHolding]);

  // 切回键盘（含 / 命令触发的程序化切换）时结束本次持握，避免录音器与遮罩被搁浅。
  React.useEffect(() => {
    if (!isVoiceMode && holdActiveRef.current) {
      void cancelHoldRecord();
    }
  }, [isVoiceMode, cancelHoldRecord]);

  // 切到后台时取消：否则麦克风会一直开到上限，并会在后台把消息自动发出去。
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && holdActiveRef.current) {
        void cancelHoldRecord();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [cancelHoldRecord]);

  const handlePointerDown = React.useCallback(async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.cancelable) {
      e.preventDefault();
    }
    // 重入守卫：第二根手指不再打断并丢弃正在进行的录音。
    if (holdActiveRef.current || activePointerIdRef.current !== null) return;
    activePointerIdRef.current = e.pointerId;
    voiceStartYRef.current = e.clientY;
    cancelSwipeThresholdRef.current = resolveCancelSwipeThresholds();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const ok = await startHoldRecord();
    if (!ok) {
      activePointerIdRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  }, [startHoldRecord]);

  const handlePointerMove = React.useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    const swipeDistance = voiceStartYRef.current - e.clientY;
    const { arm, disarm } = cancelSwipeThresholdRef.current;
    // 滞回：一旦进入取消态，要回退到更近的距离才退出，避免临界点反复跳色。
    const armed = cancelArmedRef.current
      ? swipeDistance > disarm
      : swipeDistance > arm;
    cancelArmedRef.current = armed;
    setIsCancelHovered(armed);
    const clamped = Math.max(0, Math.min(1, swipeDistance / arm));
    const quantized = Math.round(clamped * CANCEL_PROGRESS_STEPS) / CANCEL_PROGRESS_STEPS;
    setCancelSwipeProgress((current) => (current === quantized ? current : quantized));
  }, []);

  const handlePointerUp = React.useCallback(async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    // 取消与否现算坐标：pointermove 的 setState 未必在本次 pointerup 前提交，
    // 读渲染值会出现「遮罩已显示取消、实际却发送」。已进入取消态时沿用退出阈值，
    // 保证「上滑超过阈值后再回一点松手」仍然按取消处理。
    const swipeDistance = voiceStartYRef.current - e.clientY;
    const { arm, disarm } = cancelSwipeThresholdRef.current;
    const shouldCancel = cancelArmedRef.current
      ? swipeDistance > disarm
      : swipeDistance > arm;
    if (shouldCancel) {
      await cancelHoldRecord();
      return;
    }
    await finishHoldRecordRef.current("release");
  }, [cancelHoldRecord]);

  const handlePointerCancel = React.useCallback(async (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current) return;
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    // 手指滑入取消阈值才按取消处理；若未达取消阈值（如轻微滑动被系统偶发手势/失焦打断），平滑完成录音提交，避免误丢语音。
    if (cancelArmedRef.current) {
      await cancelHoldRecord();
    } else {
      await finishHoldRecordRef.current("release");
    }
  }, [cancelHoldRecord]);

  return {
    isVoiceMode,
    setIsVoiceMode,
    isHolding,
    isCancelHovered,
    cancelSwipeProgress,
    holdDurationMs,
    voiceAmplitude,
    isLimitWarning: holdDurationMs >= VOICE_LIMIT_WARNING_MS,
    startHoldRecord,
    cancelHoldRecord,
    finishHoldRecord,
    voicePointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    },
  };
}
