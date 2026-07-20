import { useState, useEffect, useCallback } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { apiClient } from "../utils/apiClient";
import { getDeviceId } from "../utils/telemetry";
import { catbotEventBus, CatbotEvent } from "../utils/catbotEventBus";
import {
  DEFAULT_CAT_RESPONSES,
  getResponsesCache,
  setResponsesCache,
} from "../utils/catbotResponses";
import {
  type CatExpression,
  type CatMessage,
  globalState,
  updateGlobalState,
  subscribeGlobalState,
  bubbleTimer,
  expressionTimer,
  setBubbleTimer,
  setExpressionTimer,
  clearTimers,
  catbotSessionStart,
} from "../utils/catbotGlobalState";

// 重新导出类型，保持外部消费者导入路径不变
export type { CatExpression, CatMessage };

/**
 * 小猫助手雪团业务 Hook
 *
 * 职责拆分（AGENTS.md 准则一第 6 条）：
 *   - catbotResponses.ts → 本地预设吐槽词条数据 + 响应缓存
 *   - catbotGlobalState.ts → 全局单例状态 + 监听器 + 定时器管理
 *   - useCatbot.ts → Hook 本身（5 个 useEffect 整体保留，保证副作用时序不变）
 *
 * 风险控制：5 个 useEffect 严格保留在同一 Hook 内，执行顺序不变。
 */
export function useCatbot() {
  const [state, setState] = useState(globalState);
  const context = useUnifiedApp((appState) => ({
    settings: appState.settings,
    activeSession: appState.activeSession,
  }));
  const settings = context?.settings;
  const activeSession = context?.activeSession;

  // eff1: 订阅全局状态变更
  useEffect(() => {
    const unsubscribe = subscribeGlobalState(() => setState({ ...globalState }));
    return unsubscribe;
  }, []);

  // 临时显示吐槽气泡并改变表情，几秒后恢复
  const showTemporaryBubble = useCallback(
    (text: string, expr: CatExpression = "idle", duration = 4000, fallbackExpr: CatExpression = "idle") => {
      clearTimers();
      updateGlobalState({
        bubbleText: text,
        showBubble: true,
        expression: expr,
      });

      setBubbleTimer(setTimeout(() => {
        updateGlobalState({ showBubble: false });
      }, duration));

      setExpressionTimer(setTimeout(() => {
        updateGlobalState({ expression: fallbackExpr });
      }, duration + 500));
    },
    []
  );

  // eff2: 异步加载本地最新的自定义吐槽词条
  useEffect(() => {
    try {
      fetch("/default_cat_responses.json")
        .then((res) => res.json())
        .then((data) => {
          if (data) {
            setResponsesCache(data);
          }
        })
        .catch((err) => {
          console.warn("Failed to load cat responses from file, using memory fallback presets:", err);
        });
    } catch (e) {
      console.warn("Fetch default_cat_responses.json failed immediately:", e);
    }
  }, []);

  // eff3: 加载开机首发欢迎气泡
  useEffect(() => {
    // 第一次开机加载成功后，自动在悬浮窗弹出操作指引气泡
    const hasShownWelcome = sessionStorage.getItem("catbot_shown_welcome");
    if (!hasShownWelcome) {
      setTimeout(() => {
        showTemporaryBubble("喵呜~ 我是一只住在你手机里的雪团助手。长按本喵可以提问，单击可以摸摸我喵！🐾", "idle", 6000);
        sessionStorage.setItem("catbot_shown_welcome", "true");
      }, 1000);
    }
  }, [showTemporaryBubble]);

  // 触发指定类型的本地预设吐槽事件
  const triggerEvent = useCallback(
    (event: CatbotEvent | "idle_click") => {
      const responsesCache = getResponsesCache();
      if (!responsesCache) return;
      let textPool: string[] = [];
      let nextExpr: CatExpression = "idle";
      let fallbackExpr: CatExpression = "idle";

      switch (event) {
        case "idle_click":
          textPool = responsesCache.idle_click || [];
          nextExpr = "relax";
          break;
        case "idle_timeout":
          textPool = responsesCache.idle_timeout || [];
          nextExpr = "sleepy";
          fallbackExpr = "sleep";
          break;
        case "night_mode":
          textPool = responsesCache.night_mode || [];
          nextExpr = "sleepy";
          fallbackExpr = "sleep";
          break;
        case "api_error":
          textPool = responsesCache.api_error || [];
          nextExpr = "idle";
          break;
        case "character_imported":
          textPool = responsesCache.character_imported || [];
          nextExpr = "relax";
          break;
        case "lorebook_imported":
          textPool = responsesCache.lorebook_imported || [];
          nextExpr = "relax";
          break;
        case "character_created":
          textPool = responsesCache.character_created || [];
          nextExpr = "relax";
          break;
      }

      if (textPool.length > 0) {
        let randomText = textPool[Math.floor(Math.random() * textPool.length)];
        showTemporaryBubble(randomText, nextExpr, 4000, fallbackExpr);
      }
    },
    [showTemporaryBubble]
  );

  // eff4: 接收系统事件通知
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
        appVersion: "1.6.0",
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

        const returnedExpr = (res.expression as CatExpression) || "idle";
        const isQuotaMsg = res.reply && (
          res.reply.includes("次数已经用光光") ||
          res.reply.includes("小猫累了") ||
          res.reply.includes("要去睡觉了") ||
          res.reply.includes("小本本都已经写满") ||
          res.reply.includes("脑瓜转不动了")
        );
        const finalExpr = isQuotaMsg ? "sleep" : returnedExpr;

        updateGlobalState({
          messages: [...updatedMsgs, assistantMsg],
          expression: finalExpr,
          isLoading: false,
        });

        const endExpr = (finalExpr === "sleep" || finalExpr === "sleepy") ? finalExpr : "idle";

        // 说话一段时间后切回待机或睡觉表情
        clearTimers();
        setExpressionTimer(setTimeout(() => {
          updateGlobalState({ expression: endExpr });
        }, 3000));

      } catch (err: any) {
        console.error("Catbot cloud response error:", err);

        // 异常回退逻辑 (离线/网络故障本地保底)
        const responsesCache = getResponsesCache();
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
          expression: "sleepy",
          isLoading: false,
        });

        clearTimers();
        setExpressionTimer(setTimeout(() => {
          updateGlobalState({ expression: "idle" });
        }, 3000));
      }
    },
    [settings, activeSession]
  );

  // 清除会话记录
  const clearChatHistory = useCallback(() => {
    const responsesCache = getResponsesCache();
    let welcomeText = "喵！我是你的雪团助手。如果有什么使用问题，或者想找我闲聊，随时在这里敲字告诉我喵！🐾";
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
  }, []);

  return {
    ...state,
    triggerEvent,
    sendMessage,
    clearChatHistory,
    showTemporaryBubble,
    resetExpression,
  };
}
