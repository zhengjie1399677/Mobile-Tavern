// AR 状态同步 hook
//
// 订阅 CharacterRenderService 的 RenderState 变更，在 AR Activity 活跃期间
// 持续推送最新角色纹理 / 情绪 / 光晕色 / 聊天气泡文本到原生层。
//
// 推送策略：
//   - 角色纹理（base64 PNG）：仅在 portraitBase64 变化时推送（避免每帧重复传输）
//   - 渲染状态（emotion + glowColors）：仅在任一字段变化时推送
//   - 聊天气泡文本：跟随最近一条 assistant 消息变化
//
// 使用方式：
//   const { isArActive, launchAr, closeAr } = useArSync(activeSession);
//   isArActive 为 true 时 UI 可显示"返回聊天"按钮，点击调用 closeAr。

import React from "react";

import { useKernel } from "../../contexts/KernelContext";
import type { IKernelService } from "../../kernel/types";
import type { RenderState } from "../../services/characterRender/pipeline";
import {
  isArSupported,
  checkArAvailability,
  launchAr as bridgeLaunchAr,
  closeAr as bridgeCloseAr,
  updateCharacterTexture,
  updateRenderState,
  updateChatBubble,
  setGestureRecognition as bridgeSetGestureRecognition,
  checkGestureRecognitionReady as bridgeCheckReady,
  listenArGestureEvent,
  type GestureEventPayload,
} from "./TavernArBridge";
import { Logger } from "../../utils/logger";
import { reportUsage } from "../../utils/telemetry";

const logger = Logger.create("useArSync");

interface UseArSyncArgs {
  /** 当前活跃 session，用于提取最近一条 assistant 消息作为聊天气泡文本。 */
  activeSession: any;
}

interface UseArSyncResult {
  /** AR Activity 是否正在前台。 */
  isArActive: boolean;
  /** 当前环境是否支持 AR（Android + ARCore）。 */
  isArAvailable: boolean;
  /** 手势识别是否已就绪（MediaPipe 模型加载完成）。 */
  isGestureReady: boolean;
  /** 手势识别是否已启用。 */
  isGestureEnabled: boolean;
  /** 最近一次手势事件。 */
  lastGesture: GestureEventPayload | null;
  /** 启动 AR Activity。 */
  launchAr: () => Promise<void>;
  /** 关闭 AR Activity，返回聊天页。 */
  closeAr: () => Promise<void>;
  /** 启用/禁用摄像头视觉手势识别。 */
  setGestureRecognition: (enabled: boolean) => Promise<void>;
}

/**
 * AR 状态同步 hook。
 *
 * 订阅 CharacterRenderService 并在 AR 活跃时把状态推送到原生层。
 * 桌面环境下 isArAvailable=false，launchAr 直接返回。
 */
export function useArSync({ activeSession }: UseArSyncArgs): UseArSyncResult {
  const kernel = useKernel();
  const [isArActive, setIsArActive] = React.useState(false);
  const [isArAvailable, setIsArAvailable] = React.useState(false);
  const [isGestureReady, setIsGestureReady] = React.useState(false);
  const [isGestureEnabled, setIsGestureEnabled] = React.useState(false);
  const [lastGesture, setLastGesture] = React.useState<GestureEventPayload | null>(null);

  // 缓存上一次推送的值，避免重复 invoke
  const lastPushedRef = React.useRef<{
    portraitBase64: string;
    emotion: string;
    light1: string;
    light2: string;
    bubbleText: string;
  }>({ portraitBase64: "", emotion: "", light1: "", light2: "", bubbleText: "" });

  // 监听手势事件（AR 活跃时）
  React.useEffect(() => {
    if (!isArActive) return;
    const unlisten = listenArGestureEvent((event) => {
      setLastGesture(event);
    });
    return () => unlisten();
  }, [isArActive]);

  // 定期检查手势识别就绪状态（AR 活跃时，模型异步加载）
  React.useEffect(() => {
    if (!isArActive) return;
    let cancelled = false;
    const checkReady = async () => {
      const ready = await bridgeCheckReady();
      if (!cancelled) setIsGestureReady(ready);
    };
    checkReady();
    // 每 2 秒检查一次，直到就绪
    const timer = setInterval(checkReady, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isArActive]);

  // 检测 AR 可用性（仅 Android 环境）
  React.useEffect(() => {
    if (!isArSupported()) {
      setIsArAvailable(false);
      return;
    }

    // 异步检查 ARCore 安装状态
    let cancelled = false;
    void (async () => {
      let status = await checkArAvailability();
      let retries = 0;
      // 如果是瞬态 unknown 状态，根据 ARCore 官方规范轮询重试，最大 5 次
      while (status === "unknown" && retries < 5 && !cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (cancelled) return;
        status = await checkArAvailability();
        retries++;
      }
      if (!cancelled) {
        logger.warn("checkArAvailability final status: " + status);
        reportUsage("ar_availability_status", { status });
        setIsArAvailable(status === "supported-installed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 提取最近一条 assistant 消息文本（作为聊天气泡）
  const lastAssistantText = React.useMemo(() => {
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        return messages[i].content as string;
      }
    }
    return "";
  }, [activeSession]);

  // 订阅 CharacterRenderService，AR 活跃时推送状态
  React.useEffect(() => {
    if (!isArActive) return;

    let unsubscribe: (() => void) | null = null;
    try {
      const service = kernel.getService<IKernelService & { subscribe(fn: (s: RenderState) => void): () => void; getState?(): RenderState | null }>("characterRender");
      if (service && typeof service.subscribe === "function") {
        unsubscribe = service.subscribe((state) => {
          // 推送角色纹理（仅当变化时）
          if (state.portraitBase64 && state.portraitBase64 !== lastPushedRef.current.portraitBase64) {
            lastPushedRef.current.portraitBase64 = state.portraitBase64;
            updateCharacterTexture(state.portraitBase64);
          }
          // 推送渲染状态（仅当任一字段变化时）
          if (
            state.emotion !== lastPushedRef.current.emotion ||
            state.glowColors?.light1 !== lastPushedRef.current.light1 ||
            state.glowColors?.light2 !== lastPushedRef.current.light2
          ) {
            lastPushedRef.current.emotion = state.emotion;
            lastPushedRef.current.light1 = state.glowColors?.light1 ?? "";
            lastPushedRef.current.light2 = state.glowColors?.light2 ?? "";
            updateRenderState(
              state.emotion,
              state.glowColors?.light1 ?? "",
              state.glowColors?.light2 ?? ""
            );
          }
        });
      }
    } catch {
      // 服务未注册或降级时静默
    }

    // 推送初始聊天气泡
    if (lastAssistantText !== lastPushedRef.current.bubbleText) {
      lastPushedRef.current.bubbleText = lastAssistantText;
      updateChatBubble(lastAssistantText);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isArActive, lastAssistantText]);

  // 聊天气泡跟随消息变化（AR 活跃时）
  React.useEffect(() => {
    if (!isArActive) return;
    if (lastAssistantText !== lastPushedRef.current.bubbleText) {
      lastPushedRef.current.bubbleText = lastAssistantText;
      updateChatBubble(lastAssistantText);
    }
  }, [isArActive, lastAssistantText]);

  const launchAr = React.useCallback(async () => {
    const result = await bridgeLaunchAr();
    if (!result.error) {
      setIsArActive(true);
      reportUsage("ar_enter", { status: "success" });
      // 启动后立即推送当前快照（若有）
      try {
        const service = kernel.getService<IKernelService & { subscribe(fn: (s: RenderState) => void): () => void; getState?(): RenderState | null }>("characterRender");
      const state = service?.getState?.();
        if (state) {
          if (state.portraitBase64) {
            lastPushedRef.current.portraitBase64 = state.portraitBase64;
            updateCharacterTexture(state.portraitBase64);
          }
          lastPushedRef.current.emotion = state.emotion;
          lastPushedRef.current.light1 = state.glowColors?.light1 ?? "";
          lastPushedRef.current.light2 = state.glowColors?.light2 ?? "";
          updateRenderState(
            state.emotion,
            state.glowColors?.light1 ?? "",
            state.glowColors?.light2 ?? ""
          );
        }
      } catch {
        // 静默
      }
      if (lastAssistantText) {
        lastPushedRef.current.bubbleText = lastAssistantText;
        updateChatBubble(lastAssistantText);
      }
    }
  }, [lastAssistantText]);

  const closeAr = React.useCallback(async () => {
    // 关闭前禁用手势识别
    if (isGestureEnabled) {
      await bridgeSetGestureRecognition(false);
      setIsGestureEnabled(false);
    }
    await bridgeCloseAr();
    setIsArActive(false);
    reportUsage("ar_exit", { action: "close" });
  }, [isGestureEnabled]);

  const setGestureRecognition = React.useCallback(async (enabled: boolean) => {
    await bridgeSetGestureRecognition(enabled);
    setIsGestureEnabled(enabled);
  }, []);

  return {
    isArActive,
    isArAvailable,
    isGestureReady,
    isGestureEnabled,
    lastGesture,
    launchAr,
    closeAr,
    setGestureRecognition,
  };
}
