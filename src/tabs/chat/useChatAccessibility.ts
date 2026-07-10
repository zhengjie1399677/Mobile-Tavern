// a11y Live Announcer + 键盘检测 + bridge effect
// 从原 ChatTab.tsx L540-626 抽离

import React from "react";

import { initTavernHelperBridge, cleanTavernHelperBridge, getBridgeInterface } from "../../utils/tavernHelper";
import { chatTabState } from "./utils";
import { globalKernel } from "../../kernel/Kernel";
import { IDatabaseService } from "../../kernel/types";
import { filterAsteriskActions } from "../../components/formattedTextUtils";

/**
 * 微内核插件式架构：会话持久化统一走 DatabaseService。
 */
function saveSession(session: any): Promise<void> {
  return globalKernel.getService<IDatabaseService>("database").saveSession(session);
}

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
      cleanTavernHelperBridge();
    }

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
    try {
      const scriptService = globalKernel.getService<any>("script");
      if (scriptService && typeof scriptService.registerBridge === "function") {
        scriptService.registerBridge(getBridgeInterface());
      }
    } catch {
      // 测试环境下 ScriptService 可能未注册，静默跳过
    }
  }, [
    activeCharId,
    activeSessionId,
    // 保留对 session 的引用依赖，以便会话内容更新时 bridge 能拿到最新数据
    activeCharacter,
    activeSession,
    settings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  // 仅在脚本关闭时清理 bridge
  React.useEffect(() => {
    if (!settings.enableScriptExecution) {
      cleanTavernHelperBridge();
    }
  }, [settings.enableScriptExecution]);

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
