// a11y Live Announcer + 键盘检测 + bridge effect
// 从原 ChatTab.tsx L540-626 抽离

import React from "react";

import { initTavernHelperBridge, cleanTavernHelperBridge, getBridgeInterface } from "../../utils/tavernHelper";
import { saveSession } from "../../utils/localDB";
import { chatTabState } from "./utils";
import { globalKernel } from "../../kernel/Kernel";
import { filterAsteriskActions } from "../../components/formattedTextUtils";

interface UseChatAccessibilityDeps {
  activeCharacter: any;
  settings: any;
  activeSession: any;
  setSessions: any;
  setCharacters: any;
  saveCharacter: any;
  updateSettings: any;
  handleSendMessage: any;
  isSending: boolean;
}

export function useChatAccessibility(deps: UseChatAccessibilityDeps) {
  const {
    activeCharacter,
    settings,
    activeSession,
    setSessions,
    setCharacters,
    saveCharacter,
    updateSettings,
    handleSendMessage,
    isSending,
  } = deps;

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

  // Keep the bridge params in sync with latest React state on every relevant change.
  // We do NOT call cleanTavernHelperBridge() inside the cleanup because that would
  // destroy the bridge (and all iframe event listeners) on every activeSession update.
  // The bridge is only torn down when the ChatTab itself unmounts.
  React.useEffect(() => {
    if (settings.enableScriptExecution) {
      initTavernHelperBridge({
        activeCharacter,
        activeSession,
        setSessions,
        saveSession,
        setCharacters,
        saveCharacter,
        settings,
        updateSettings,
        handleSendMessage,
      });
      // 应用层显式装配 ScriptService bridge 接口（遵循 AGENTS.md 准则一.1）：
      // utils 层不再反向调用 kernel.getService("script").registerBridge，
      // 由本应用层在 initTavernHelperBridge 完成后通过 getBridgeInterface() 取得接口并装配。
      try {
        const scriptService = globalKernel.getService<any>("script");
        if (scriptService && typeof scriptService.registerBridge === "function") {
          scriptService.registerBridge(getBridgeInterface());
        }
      } catch {
        // 测试环境下 ScriptService 可能未注册，静默跳过
      }
    } else {
      cleanTavernHelperBridge();
    }
  }, [
    activeCharacter,
    activeSession,
    setSessions,
    setCharacters,
    settings,
    updateSettings,
    handleSendMessage,
  ]);

  // Only clean up the bridge when the ChatTab unmounts entirely.
  React.useEffect(() => {
    return () => {
      cleanTavernHelperBridge();
    };
  }, []);

  const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      const vvp = window.visualViewport;
      // 视口高度使用 Math.min(vvp.height, window.innerHeight) 以消除 Android 偏大偏差
      const currentHeight = vvp ? Math.min(vvp.height, window.innerHeight) : window.innerHeight;

      if (currentHeight > chatTabState.maxHeight) {
        chatTabState.maxHeight = currentHeight;
      }
      const threshold = Math.min(chatTabState.maxHeight * 0.15, 100);
      const isNowOpen = chatTabState.maxHeight - currentHeight > threshold;
      setIsKeyboardOpen(isNowOpen);
    };

    window.addEventListener("resize", handleResize);
    const vvp = window.visualViewport;
    if (vvp) {
      vvp.addEventListener("resize", handleResize);
    }
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (vvp) {
        vvp.removeEventListener("resize", handleResize);
      }
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
      const ttsService = globalKernel.getService<any>("tts");
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
        }).catch((err: any) => {
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
