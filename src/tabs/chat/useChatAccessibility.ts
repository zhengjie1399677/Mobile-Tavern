// a11y Live Announcer + 键盘检测 + bridge effect
// 从原 ChatTab.tsx L540-626 抽离

import React from "react";

import { initTavernHelperBridge, cleanTavernHelperBridge } from "../../utils/tavernHelper";
import { saveSession } from "../../utils/localDB";
import { chatTabState } from "./utils";

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

  return {
    announcement,
    isKeyboardOpen,
  };
}
