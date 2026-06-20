import { useState, useEffect, useCallback, useContext } from "react";
import { AppContext } from "../AppContext";
import { apiClient } from "../utils/apiClient";
import { getDeviceId } from "../utils/telemetry";
import { catbotEventBus, CatbotEvent } from "../utils/catbotEventBus";

const catbotSessionStart = Date.now();

export type CatExpression = "idle" | "thinking" | "relax" | "sleepy" | "sleep";

export interface CatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

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
      content: "喵呜~ 我是一只住在你手机里、专门帮你管酒馆的小懒猫雪团喵！🐾 长按本喵可以快捷打开/收起这个大面板。如果遇到什么配置问题，或者单纯想摸摸本喵闲聊，随时在这里打字告诉我喵！✨",
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

const DEFAULT_CAT_RESPONSES = {
  "idle_click": [
    "喵？找本喵有什么事情嘛？",
    "酒馆今天也很热闹呢，要不要找个角色聊聊？",
    "呼咪……被你戳醒了喵！",
    "不要一直点人家啦，爪子要伸出来了喵！",
    "本喵正在巡逻酒馆，没有偷懒喵！",
    "偷偷告诉你，酒馆里的角色卡其实都藏在 IndexedDB 抽屉里喵~",
    "摸摸本喵的头可以获得双倍的好运喵！(长按本喵可以提问喵~)",
    "呼噜噜……好舒服喵，再摸一下嘛~",
    "如果你发现AI不理你了，记得去设置里点下【测试 API】检查一下喵！",
    "咕噜咕噜……（小猫舒服地眯起了眼睛）",
    "喵呜~ 原生 WebView 里面下载文件要走我们的原生桥接哦，本喵已经帮你打通了通道喵！",
    "今天的角色卡都亮晶晶的，是不是因为你偷偷给它们打扫过了喵？",
    "小猫雪团今天也在认真地监督 API 的额度，没有乱吃小鱼干喵！",
    "（伸出爪子轻轻拍了拍你的手）喂，不要只顾着和角色卡聊天，也多跟本喵说说话嘛喵~",
    "据说把状态栏调成适合主题的颜色，酒馆的视觉效果会更好看哦喵！",
    "大拇指单手操作很方便吧？这是本喵特意为你优化的底部交互布局喵！",
    "喵？要本喵给你倒一杯牛奶，还是长按本喵向我提问喵？",
    "如果遇到了奇怪的解析错误，可以看看文件是不是 SillyTavern 标准的 PNG 格式喵。",
    "哎呀，不要戳本喵的肉垫，好痒的喵！🐾",
    "（抖了抖耳朵）你刚才是不是悄悄叹气了？有什么烦恼可以跟本喵聊聊喵~",
    "本喵刚才在 IndexedDB 里抓到了一只小老鼠……开玩笑的，里面只有你珍贵的角色卡喵！"
  ],
  "idle_timeout": [
    "喵……你已经盯着屏幕发呆三分钟了，是在想哪个角色卡吗？",
    "喂，再不行动本喵就要睡着了喵……💤",
    "（猫咪伸了个懒腰）闲着也是闲着，要不要去设置里整理一下你的 API 密钥喵？"
  ],
  "night_mode": [
    "已经很晚了喵，熬夜会掉毛的，早点休息吧！",
    "月亮都升起来了，酒馆的灯光刚刚好，还不打算睡觉吗喵？",
    "深夜是灵感迸发的时刻，但也要注意身体喵~"
  ],
  "api_error": [
    "喵呜！网络好像断掉了，还是说你的 API 密钥过期了喵？快去控制面板看看！",
    "哎呀，大模型服务商拒绝了我们的请求，是不是额度用光了喵？",
    "连接失败喵！网络堵车了，快去检查一下代理或者 API 终点配置！"
  ],
  "character_imported": [
    "哇！酒馆里又迎来了新的伙伴，快去和它打个招呼喵！",
    "新角色卡导入成功！这只看起来很有个性，本喵表示认可喵~",
    "（好奇地凑过去）新来的角色喜欢吃小鱼干吗？喵~"
  ],
  "character_created": [
    "哇！新角色卡诞生了喵！本喵已经把它小心翼翼地放进 IndexedDB 抽屉里了喵~",
    "（喵呜一声）酒馆又迎来了一位全新创造的伙伴，快去开启属于你们的冒险吧！",
    "新卡生成成功！雪团已经把它的故事底稿都整理好了，快去和它打招呼喵！"
  ],
  "lorebook_imported": [
    "世界设定导入成功！本喵在它的世界书里闻到了奇幻小鱼干的味道喵~",
    "（好奇地拍了拍书页）哇，好多新词条！角色卡的世界观一下子变得宏大起来了喵！",
    "世界设定已经合入成功！本喵正努力帮角色记住这些背景设定，放心聊天吧喵！"
  ],
  "cloud_fallback": {
    "welcome": "喵！我是你的雪团助手。如果你有任何使用问题，或者想找我闲聊，直接在这里打字告诉我吧喵！",
    "offline": "哎呀，现在云端判定服务暂时开小差了喵……你可以检查一下网络，或者稍后再试！",
    "error_guidance": "检测到你刚才遇到了连接问题。本喵建议你：\n1. 检查设置里的 API Key 和 Base URL 是否填错。\n2. 检查本地代理是否开启了 TUN 模式阻断了请求。\n3. 确认服务商的额度是否充足喵！"
  }
};

let responsesCache: any = DEFAULT_CAT_RESPONSES;
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

  // 清除定时器
  const clearTimers = useCallback(() => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (expressionTimer) clearTimeout(expressionTimer);
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

      bubbleTimer = setTimeout(() => {
        updateGlobalState({ showBubble: false });
      }, duration);

      expressionTimer = setTimeout(() => {
        updateGlobalState({ expression: fallbackExpr });
      }, duration + 500);
    },
    [clearTimers]
  );

  // 异步加载本地最新的自定义吐槽词条
  useEffect(() => {
    try {
      fetch("/default_cat_responses.json")
        .then((res) => res.json())
        .then((data) => {
          if (data) {
            responsesCache = data;
          }
        })
        .catch((err) => {
          console.warn("Failed to load cat responses from file, using memory fallback presets:", err);
        });
    } catch (e) {
      console.warn("Fetch default_cat_responses.json failed immediately:", e);
    }
  }, []);

  // 加载开机首发欢迎气泡
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
        appVersion: "1.5.3",
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
        if (expressionTimer) clearTimeout(expressionTimer);
        expressionTimer = setTimeout(() => {
          updateGlobalState({ expression: endExpr });
        }, 3000);

      } catch (err: any) {
        console.error("Catbot cloud response error:", err);
        
        // 异常回退逻辑 (离线/网络故障本地保底)
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
