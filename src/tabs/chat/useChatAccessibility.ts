// a11y Live Announcer + 键盘检测 + bridge effect
// 从原 ChatTab.tsx L540-626 抽离

import React from "react";

import lodashCloneDeep from "lodash/cloneDeep";
import lodashIsEqual from "lodash/isEqual";
import { Logger } from "../../utils/logger";
import { reportUsage } from "../../utils/telemetry";

const logger = Logger.create("ChatAccessibility");
import { useKernel } from "../../contexts/KernelContext";
import {
  IDatabaseService,
  ITtsService,
  KernelServices,
  type ICompatibilityRuntimeService,
} from "@/src/application/serviceContracts";
import { ChatSession, CharacterCard, SummaryCard, Message } from "../../types";
import { filterAsteriskActions } from "../../components/formattedTextUtils";
import type { CompatibilityBridgeParams } from "../../application/compatibility/contracts";
import {
  resolveAppViewportHeight,
  resolveKeyboardViewportState,
  type KeyboardViewportState,
} from "../../utils/viewportLayout";

interface UseChatAccessibilityDeps
  extends Omit<CompatibilityBridgeParams, "saveSession" | "setSessions"> {
  setSessionViews: CompatibilityBridgeParams["setSessions"];
  isSending: boolean;
}

export function useChatAccessibility(deps: UseChatAccessibilityDeps) {
  const kernel = useKernel();
  const compatibilityRuntime = kernel.getService<ICompatibilityRuntimeService>(
    KernelServices.CompatibilityRuntime,
  );
  const compatibilityRenderer = compatibilityRuntime.getRenderer();
  const databaseService = kernel.getService<IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>>("database");
  const saveSession = async (session: ChatSession): Promise<void> => {
    const current = compatibilityRenderer?.getBridgeParams()?.activeSession;
    const currentMessages = new Map((current?.messages ?? []).map((message) => [message.id, message]));
    const changedMessages = session.messages.filter((message) => {
      const previous = currentMessages.get(message.id);
      return !previous || !lodashIsEqual(previous, message);
    });
    await databaseService.updateSessionMetadata(session.id, {
      variables: undefined,
      runtimePluginState: session.runtimePluginState,
    });
    for (const message of changedMessages) {
      await databaseService.appendSessionMessage(session.id, message);
    }
  };

  const {
    activeCharacter,
    settings,
    activeSession,
    setSessionViews,
    setCharacters,
    saveCharacter,
    updateSettings,
    handleSendMessage,
    isSending,
  } = deps;

  // Render-phase sync: 强行在渲染阶段将最新的会话与配置同步给 bridge params。
  // 这能确保在任何子组件（如 FormattedText）挂载、iframe 加载及 _onIframeReady() 触发时，
  // 它们都能够直接、同步且无时序滞后地通过 getBridgeParams() 拿到最新的 activeSession。
  if (settings.enableScriptExecution && compatibilityRenderer) {
    compatibilityRenderer.updateBridge({ activeCharacter, activeSession, settings });
  }

  // a11y Live Announcer state and effect
  const [announcement, setAnnouncement] = React.useState("");
  const wasSendingRef = React.useRef(false);

  React.useEffect(() => {
    if (isSending) {
      setAnnouncement(`${activeCharacter?.name || "角色"} 正在思考并输入...`);
      wasSendingRef.current = true;
    } else if (wasSendingRef.current) {
      setAnnouncement("收到新消息");
      wasSendingRef.current = false;
      const timer = setTimeout(() => {
        setAnnouncement("");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSending, activeCharacter?.name]);

  // ── Bridge 参数同步：每次渲染时将最新 params 同步给 bridge，
  // 确保 getBridgeParams() 始终读到最新的 activeSession / activeCharacter，
  // 同时通过 ID 比对避免每次发消息都触发 mag_variable_initialized 广播。
  const activeCharId = activeCharacter?.id;
  const activeSessionId = activeSession?.id;

  const prevCharIdRef = React.useRef(activeCharId);
  const prevSessionIdRef = React.useRef(activeSessionId);

  // 每次渲染都把最新 params 写入 bridge（不触发重初始化，仅更新引用）
  // 注意：此处使用 useEffect 而非渲染体副作用，避免并发模式下的竞争条件。
  React.useEffect(() => {
    if (!settings.enableScriptExecution) return;

    // 当角色 ID 或会话 ID 发生真实切换时，先清理旧的 bridge 事件监听器，
    // 防止上一个角色/会话注册的回调留在事件总线上导致每次广播触发多份重复回调。
    if (prevCharIdRef.current !== activeCharId || prevSessionIdRef.current !== activeSessionId) {
      prevCharIdRef.current = activeCharId;
      prevSessionIdRef.current = activeSessionId;
      compatibilityRenderer?.cleanBridge();
    }

    compatibilityRenderer?.initializeBridge({
      activeCharacter,
      activeSession,
      setSessions: setSessionViews,
      saveSession,
      setCharacters,
      saveCharacter,
      settings,
      updateSettings,
      handleSendMessage,
    });
  }, [
    activeCharId,
    activeSessionId,
    settings.enableScriptExecution,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  // 轻量引用同步 effect：仅在 session/character 引用变化时同步给 bridge 状态，不执行重初始化，避免 60ms 高频开销
  const prevVarsRef = React.useRef<unknown>(null);
  React.useEffect(() => {
    if (!settings.enableScriptExecution) return;
    const params = compatibilityRenderer?.getBridgeParams();
    if (params) {
      params.activeCharacter = activeCharacter;
      params.activeSession = activeSession;
      params.settings = settings;

      // 仅更新内存引用比对，不进行事件广播，避免在 React 渲染过程中因竞态引发未自愈的空变量覆盖
      const currentVars = activeSession
        ? compatibilityRuntime.readState(activeSession)
        : undefined;
      if (currentVars && !lodashIsEqual(prevVarsRef.current, currentVars)) {
        prevVarsRef.current = lodashCloneDeep(currentVars);
      }
    }
  }, [activeCharacter, activeSession, settings]);

  // 仅在脚本关闭时清理 bridge
  React.useEffect(() => {
    if (!settings.enableScriptExecution) {
      compatibilityRenderer?.cleanBridge();
    }
  }, [settings.enableScriptExecution]);

  // Only clean up the bridge when the ChatTab unmounts entirely.
  React.useEffect(() => {
    return () => {
      compatibilityRenderer?.cleanBridge();
    };
  }, []);

  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

  React.useEffect(() => {
    const initialHeight = resolveAppViewportHeight(window.innerHeight, window.visualViewport?.height);
    let viewportState: KeyboardViewportState = {
      baselineHeight: initialHeight,
      viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      isOpen: false,
    };
    let frameId: number | null = null;

    const applyViewportState = () => {
      frameId = null;
      const vvp = window.visualViewport;
      const currentHeight = resolveAppViewportHeight(window.innerHeight, vvp?.height);
      const currentWidth = vvp?.width ?? window.innerWidth;
      const nextState = resolveKeyboardViewportState(viewportState, currentHeight, currentWidth);

      // resize 动画只在状态真正转换时触发 React 更新和诊断，避免逐帧重渲染/遥测。
      if (viewportState.isOpen !== nextState.isOpen) {
        const diff = nextState.baselineHeight - currentHeight;
        logger.warn("Viewport resize handled (keyboard transition check)", {
          vvpHeight: vvp?.height ?? null,
          windowHeight: window.innerHeight,
          currentHeight,
          maxHeight: nextState.baselineHeight,
          threshold: Math.min(nextState.baselineHeight * 0.15, 100),
          heightDiff: diff,
          isKeyboardOpen: nextState.isOpen,
        });

        reportUsage("keyboard_viewport_diagnostic", {
          vvp_height: vvp?.height ?? 0,
          window_height: window.innerHeight,
          current_height: currentHeight,
          max_height: nextState.baselineHeight,
          height_diff: diff,
          is_keyboard_open: nextState.isOpen,
        });
        setIsKeyboardOpen(nextState.isOpen);
      }
      viewportState = nextState;
    };

    const handleResize = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applyViewportState);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    window.addEventListener("mobileTavernNativeResume", handleResize);
    const vvp = window.visualViewport;
    if (vvp) {
      vvp.addEventListener("resize", handleResize);
    }
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.removeEventListener("mobileTavernNativeResume", handleResize);
      if (vvp) {
        vvp.removeEventListener("resize", handleResize);
      }
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  // 语音自动朗读逻辑
  const lastSpokenMsgIdRef = React.useRef<string | null>(null);
  const lastSessionIdRef = React.useRef<string | null>(null);

  // 1. 切换会话时重置或初始化 lastSpokenMsgId，防止刚切进来误读历史消息
  React.useEffect(() => {
    if (activeSession?.id) {
      if (activeSession.id !== lastSessionIdRef.current) {
        lastSessionIdRef.current = activeSession.id;
        const messages = activeSession.messages;
        if (messages && messages.length > 0) {
          lastSpokenMsgIdRef.current = messages[messages.length - 1].id;
        } else {
          lastSpokenMsgIdRef.current = null;
        }
      }
    } else {
      lastSessionIdRef.current = null;
      lastSpokenMsgIdRef.current = null;
    }
  }, [activeSession?.id, activeSession?.messages]);

  // 2. 监听消息接收完成并触发朗读
  React.useEffect(() => {
    // 仅在 TTS 开启且设为自动朗读且不处于发送中状态时触发
    if (!settings.ttsConfig?.enabled || settings.ttsConfig.playMode === "manual" || isSending) {
      return;
    }

    const messages = activeSession?.messages;
    if (!messages || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    
    // 只自动朗读 assistant (对方) 的消息
    if (lastMsg.sender !== "assistant") return;

    // 防止重复朗读
    if (lastSpokenMsgIdRef.current === lastMsg.id) return;

    try {
      const ttsService = kernel.getService<ITtsService>("tts");
      if (ttsService) {
        lastSpokenMsgIdRef.current = lastMsg.id;

        let textToSpeak = lastMsg.content;
        if (settings.ttsConfig?.readMode === "dialogue_only") {
          const filtered = filterAsteriskActions(lastMsg.content);
          if (filtered.trim().length > 0) {
            textToSpeak = filtered;
          }
        }

        ttsService.speak(textToSpeak, {
          ...settings.ttsConfig,
          messageId: lastMsg.id,
        }).catch((err: unknown) => {
          console.error("[TTS AutoPlay] Speak failed:", err);
        });
      }
    } catch (e) {
      console.warn("[TTS AutoPlay] ttsService not found or failed:", e);
    }
  }, [activeSession?.messages, isSending, settings.ttsConfig]);

  return {
    announcement,
    isKeyboardOpen,
  };
}
