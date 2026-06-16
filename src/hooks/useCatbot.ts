import { useState, useEffect, useCallback, useContext } from "react";
import { AppContext } from "../AppContext";
import { apiClient } from "../utils/apiClient";
import { getDeviceId } from "../utils/telemetry";

const catbotSessionStart = Date.now();

export type CatExpression = "idle" | "thinking" | "talking" | "sad";

export interface CatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type CatbotEvent = "api_error" | "character_imported" | "night_mode" | "idle_timeout";

type CatbotListener = (event: CatbotEvent) => void;

class CatbotEventBus {
  private listeners: CatbotListener[] = [];

  subscribe(listener: CatbotListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: CatbotEvent) {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (e) {
        console.error("Failed to execute Catbot listener", e);
      }
    });
  }
}

export const catbotEventBus = new CatbotEventBus();

// 全局单例状态，防止页面组件切换卸载时状态和聊天历史丢失
interface CatbotGlobalState {
  expression: CatExpression;
  messages: CatMessage[];
  bubbleText: string;
  showBubble: boolean;
  isLoading: boolean;
}

let globalState: CatbotGlobalState = {
  expression: "idle",
  messages: [
    {
      id: "welcome",
      role: "assistant",
      content: "喵！我是你的酒馆专属小助手。如果有什么使用问题，或者想找我闲聊，随时在这里敲字告诉我喵！🐾",
      timestamp: Date.now(),
    },
  ],
  bubbleText: "",
  showBubble: false,
  isLoading: false,
};

const listeners = new Set<() => void>();

function updateGlobalState(updates: Partial<CatbotGlobalState>) {
  globalState = { ...globalState, ...updates };
  listeners.forEach((listener) => listener());
}

let responsesCache: any = null;
let bubbleTimer: any = null;
let expressionTimer: any = null;

export function useCatbot() {
  const [state, setState] = useState<CatbotGlobalState>(globalState);
  const context = useContext(AppContext);
  const settings = context?.settings;
  const activeSession = context?.activeSession;

  useEffect(() => {
    const listener = () => setState(globalState);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // 加载本地预设回复
  useEffect(() => {
    if (responsesCache) return;
    fetch("/default_cat_responses.json")
      .then((res) => res.json())
      .then((data) => {
        responsesCache = data;
      })
      .catch((err) => {
        console.error("Failed to load predefined cat responses:", err);
      });
  }, []);

  // 清除定时器
  const clearTimers = useCallback(() => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (expressionTimer) clearTimeout(expressionTimer);
  }, []);

  // 临时显示吐槽气泡并改变表情，几秒后恢复
  const showTemporaryBubble = useCallback(
    (text: string, expr: CatExpression = "talking", duration = 4000) => {
      clearTimers();
      updateGlobalState({
        bubbleText: text,
        showBubble: true,
        expression: expr,
      });

      bubbleTimer = setTimeout(() => {
        updateGlobalState({ showBubble: false });
      }, duration);

      expressionTimer = setTimeout(() => {
        updateGlobalState({ expression: "idle" });
      }, duration + 500);
    },
    [clearTimers]
  );

  // 触发指定类型的本地预设吐槽事件
  const triggerEvent = useCallback(
    (event: CatbotEvent | "idle_click") => {
      if (!responsesCache) return;
      let textPool: string[] = [];
      let nextExpr: CatExpression = "talking";

      switch (event) {
        case "idle_click":
          textPool = responsesCache.idle_click || [];
          break;
        case "idle_timeout":
          textPool = responsesCache.idle_timeout || [];
          break;
        case "night_mode":
          textPool = responsesCache.night_mode || [];
          break;
        case "api_error":
          textPool = responsesCache.api_error || [];
          nextExpr = "sad";
          break;
        case "character_imported":
          textPool = responsesCache.character_imported || [];
          break;
      }

      if (textPool.length > 0) {
        const randomText = textPool[Math.floor(Math.random() * textPool.length)];
        showTemporaryBubble(randomText, nextExpr);
      }
    },
    [showTemporaryBubble]
  );

  // 接收系统事件通知
  useEffect(() => {
    const handleSystemEvent = (event: CatbotEvent) => {
      // 稍微延迟一小会触发，给 UI 更平滑的感受
      setTimeout(() => {
        triggerEvent(event);
      }, 500);
    };

    const unsubscribe = catbotEventBus.subscribe(handleSystemEvent);
    return unsubscribe;
  }, [triggerEvent]);

  // 主动发送消息给云端
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      const userMsg: CatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };

      const updatedMsgs = [...globalState.messages, userMsg];
      updateGlobalState({
        messages: updatedMsgs,
        expression: "thinking",
        isLoading: true,
      });

      // 动态收集设备上下文诊断数据
      const clientContext = {
        deviceId: getDeviceId(),
        userName: settings?.userName || "未知",
        phoneModel: typeof navigator !== "undefined" ? navigator.userAgent : "Unknown",
        appVersion: "1.4.0",
        isTauri: apiClient.isClientMode(),
        apiBaseUrl: settings?.api?.baseUrl || "",
        apiModel: settings?.api?.modelName || "",
        activeSessionMessages: activeSession?.messages?.length || 0,
        playTimeSec: Math.round((Date.now() - catbotSessionStart) / 1000),
        clientTime: new Date().toISOString()
      };

      try {
        // 创建 1 分钟超时 Promise
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 60000)
        );

        // 请求云端处理与判定，并与超时竞争
        const res = await Promise.race([
          apiClient.sendCatbotRequest(content, updatedMsgs, clientContext),
          timeoutPromise,
        ]);
        
        const assistantMsg: CatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: res.reply || "喵呜，云端连接好像有些异常，本喵不知道怎么回答了喵……",
          timestamp: Date.now(),
        };

        updateGlobalState({
          messages: [...updatedMsgs, assistantMsg],
          expression: (res.expression as CatExpression) || "talking",
          isLoading: false,
        });

        // 说话一段时间后切回待机表情
        if (expressionTimer) clearTimeout(expressionTimer);
        expressionTimer = setTimeout(() => {
          updateGlobalState({ expression: "idle" });
        }, 3000);

      } catch (err: any) {
        console.error("Catbot cloud response error:", err);
        
        // 异常回退逻辑
        let fallbackText = "喵呜，云端判定服务开小差了，要不要检查下网络或者设置喵？";
        if (err && err.message === "TIMEOUT") {
          fallbackText = "喵呜呜……等了太久云端都没有反应喵，可能脑回路断掉了，稍后再试试看喵？🐾";
        } else if (responsesCache && responsesCache.cloud_fallback) {
          fallbackText = responsesCache.cloud_fallback.offline;
        }

        const assistantMsg: CatMessage = {
          id: `assistant-err-${Date.now()}`,
          role: "assistant",
          content: fallbackText,
          timestamp: Date.now(),
        };

        updateGlobalState({
          messages: [...updatedMsgs, assistantMsg],
          expression: "sad",
          isLoading: false,
        });

        if (expressionTimer) clearTimeout(expressionTimer);
        expressionTimer = setTimeout(() => {
          updateGlobalState({ expression: "idle" });
        }, 3000);
      }
    },
    [settings, activeSession]
  );

  // 清除会话记录
  const clearChatHistory = useCallback(() => {
    let welcomeText = "喵！我是你的酒馆专属小助手。如果有什么使用问题，或者想找我闲聊，随时在这里敲字告诉我喵！🐾";
    if (responsesCache && responsesCache.cloud_fallback) {
      welcomeText = responsesCache.cloud_fallback.welcome;
    }
    updateGlobalState({
      messages: [
        {
          id: "welcome",
          role: "assistant",
          content: welcomeText,
          timestamp: Date.now(),
        },
      ],
      expression: "idle",
      isLoading: false,
    });
  }, []);

  // 重置表情到闲置状态
  const resetExpression = useCallback(() => {
    clearTimers();
    updateGlobalState({
      expression: "idle",
      showBubble: false,
    });
  }, [clearTimers]);

  return {
    ...state,
    triggerEvent,
    sendMessage,
    clearChatHistory,
    showTemporaryBubble,
    resetExpression,
  };
}
