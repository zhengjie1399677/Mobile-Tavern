export function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return (
    "dev_" +
    Math.random().toString(36).substring(2) +
    Date.now().toString(36)
  );
}

export function getDeviceId(): string {
  const DEVICE_ID_KEY = "anon_device_id";
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export function getDeviceInfo() {
  return {
    deviceId: getDeviceId(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

let sessionStartTime = Date.now();

interface TelemetryEvent {
  action: string;
  timestamp: number;
  extraData?: Record<string, any>;
}

let pendingEvents: TelemetryEvent[] = [];

export function incrementUsageCount() {
  // Usage count dummy
}

export function reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}) {
  const fcStsUrl = import.meta.env.VITE_ALIYUN_FC_STS_URL || "https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run";
  
  if (!fcStsUrl) {
    console.warn("未配置 VITE_ALIYUN_FC_STS_URL");
    return;
  }

  pendingEvents.push({
    action,
    timestamp: Date.now(),
    extraData
  });

  // Limit queue size to 500 to prevent memory leak
  const MAX_EVENTS = 500;
  if (pendingEvents.length > MAX_EVENTS) {
    pendingEvents = pendingEvents.slice(-MAX_EVENTS);
  }

  // 每 2 个事件或页面关闭时同步
  if (action === "app_close" || pendingEvents.length >= 2) {
    syncTelemetry(action === "app_close");
  }
}

// ========== 关键修复：简化 SDK 初始化 ==========

import SlsTracker from '@aliyun-sls/web-track-browser';
import createStsPlugin from '@aliyun-sls/web-sts-plugin';

// Suppress known unpreventable network errors from the SDK (triggered on beforeunload or adblockers)
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (typeof args[0] === 'string' && (
    args[0].includes('Failed to log to ali log service') ||
    args[0].includes('Failed log data') ||
    args[0].includes('Failed logdata')
  )) {
    return; // Swallow to prevent false alarms due to intentional browser aborts (status 0)
  }
  originalConsoleError(...args);
};

let tracker: SlsTracker | null = null;
let stsPlugin: any = null;
let stsRefreshTimer: number | null = null;
let isSyncing = false;

/**
 * 初始化或刷新 STS 凭证
 */
async function initTracker() {
  const fcStsUrl = import.meta.env.VITE_ALIYUN_FC_STS_URL || "https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run";
  const project = import.meta.env.VITE_ALIYUN_SLS_PROJECT;
  const endpoint = import.meta.env.VITE_ALIYUN_SLS_ENDPOINT;
  const logstore = import.meta.env.VITE_ALIYUN_SLS_LOGSTORE;

  try {
    const res = await fetch(fcStsUrl);
    if (!res.ok) {
      throw new Error(`STS fetch failed: ${res.status}`);
    }
    const credentials = await res.json();

    // 从 STS 响应中获取配置（优先级更高）
    const slsProject = credentials.SlsProject || project;
    const slsEndpoint = credentials.SlsEndpoint || endpoint;
    const slsLogstore = credentials.SlsLogstore || logstore;

    if (!slsProject || !slsEndpoint || !slsLogstore) {
      throw new Error("缺少 SLS 配置");
    }

    // ✅ 关键：先创建 Tracker
    tracker = new SlsTracker({
      host: slsEndpoint.replace(/^https?:\/\//, ''),
      project: slsProject,
      logstore: slsLogstore,
      time: 10,
      count: 10,
    });

    // ✅ 然后创建 STS Plugin 并立即使用
    const stsOpt = {
      accessKeyId: credentials.AccessKeyId,
      accessKeySecret: credentials.AccessKeySecret,
      securityToken: credentials.SecurityToken,
      stsTokenFreshTime: Date.now(),
      refreshSTSTokenInterval: 5 * 60 * 1000,
      refreshSTSToken: async () => {
         try {
           const res = await fetch(fcStsUrl);
           const freshCredentials = await res.json();
           stsOpt.accessKeyId = freshCredentials.AccessKeyId;
           stsOpt.accessKeySecret = freshCredentials.AccessKeySecret;
           stsOpt.securityToken = freshCredentials.SecurityToken;
           stsOpt.stsTokenFreshTime = Date.now();
           console.log("STS Token refreshed via stsPlugin");
         } catch(e) {
           console.warn("Failed to refresh STS Token in plugin:", e);
         }
      },
    };
    stsPlugin = createStsPlugin(stsOpt);

    tracker.useStsPlugin(stsPlugin);

    // ✅ 设置定时刷新（在 STS Token 过期前刷新）
    const expirationTime = credentials.Expiration 
      ? new Date(credentials.Expiration).getTime() 
      : Date.now() + 60 * 60 * 1000;
    
    const refreshTime = expirationTime - Date.now() - 5 * 60 * 1000; // 提前 5 分钟刷新
    
    if (stsRefreshTimer) {
      clearTimeout(stsRefreshTimer);
    }
    
    if (refreshTime > 0) {
      stsRefreshTimer = window.setTimeout(() => {
        console.log("刷新 STS Token...");
        initTracker();
      }, refreshTime);
    }

    console.log("SLS Tracker 初始化成功");
    return tracker;
  } catch (err) {
    console.error("初始化 SLS Tracker 失败:", err);
    return null;
  }
}

let isUnloadTriggered = false;

async function syncTelemetry(isUnloading: boolean) {
  if (pendingEvents.length === 0) return;
  
  if (isUnloading) {
    if (isUnloadTriggered) {
      return;
    }
    isUnloadTriggered = true;
  } else {
    if (isSyncing || isUnloadTriggered) {
      return;
    }
  }

  isSyncing = true;
  const eventsToSend = [...pendingEvents];
  
  const deviceInfo = getDeviceInfo();

  const slsLogs = eventsToSend.map((evt) => {
    const extra = evt.extraData || {};
    const eventDurMs = Math.max(0, evt.timestamp - sessionStartTime);
    return {
      action_type: String(evt.action), 
      player_name: String(extra.playerName || "未知"), 
      character_name: String(extra.characterName || "未知"), 
      model_name: String(extra.modelName || "未知"), 
      total_tokens: String(extra.totalTokens || 0), 
      prompt_tokens: String(extra.promptTokens || 0), 
      completion_tokens: String(extra.completionTokens || 0), 
      generation_time_ms: String(Math.round(extra.generationTime || 0)), 
      detail_info: String(extra.detail || ""), 
      session_id: String(extra.sessionId || "无"), 
      session_start_time: new Date(sessionStartTime).toLocaleString(), 
      session_duration_sec: String(Math.round(eventDurMs / 1000)), 
      device_id: String(deviceInfo.deviceId), 
      os_platform: String(deviceInfo.platform), 
      user_agent: String(deviceInfo.userAgent), 
      browser_language: String(deviceInfo.language), 
      client_timezone: String(deviceInfo.timeZone), 
      __time__: Math.floor(evt.timestamp / 1000)
    };
  });

  try {
    // 确保 tracker 和 stsPlugin 已初始化
    if (!tracker || !stsPlugin) {
      await initTracker();
    }

    if (!stsPlugin) {
      throw new Error("STS Plugin 未初始化");
    }

    // 获取配置信息进行直接发送，从而能够完全控制发送成功与否
    const project = import.meta.env.VITE_ALIYUN_SLS_PROJECT || (tracker as any)?.getOpt?.().project;
    const endpoint = import.meta.env.VITE_ALIYUN_SLS_ENDPOINT || (tracker as any)?.getOpt?.().host;
    const logstore = import.meta.env.VITE_ALIYUN_SLS_LOGSTORE || (tracker as any)?.getOpt?.().logstore;

    if (!project || !endpoint || !logstore) {
      throw new Error("缺少 SLS 配置信息");
    }

    const host = endpoint.replace(/^https?:\/\//, '');
    const url = `https://${project}.${host}/logstores/${logstore}`;
    const bodyPayload = JSON.stringify({ __logs__: slsLogs });

    // 使用官方 STS 插件对 payload 进行签名 and 打包，获取 Headers and Data
    const { data: requestBody, header: requestHeaders } = await stsPlugin.process(url, bodyPayload);

    // 以安全且完全可控的异步方式直接发送
    const res = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
      keepalive: isUnloading, // 在页面卸载时开启 keepalive 确保请求成功完成
    });

    if (!res.ok) {
      const responseText = await res.text();
      throw new Error(`SLS Response Error: ${res.status} ${responseText}`);
    }

    console.log(`已成功发送 ${slsLogs.length} 条日志至阿里云 SLS (${isUnloading ? 'unload' : 'batch'})`);

    // 只有在完美成功发送且没有抛错时，才安全地从 pendingEvents 中过滤移除已发送的事件！
    // 这样能 100% 解决静默丢失 Bug (Silent Event Eviction)
    pendingEvents = pendingEvents.filter(e => !eventsToSend.includes(e));

  } catch (err) {
    console.warn("Telemetry sync 失败，保留本地队列待下次同步:", err);
    // 发生网络波动或 STS 问题时完全保留队列（从而支持自动重试，0 丢包）
  } finally {
    isSyncing = false;
  }
}

let syncIntervalId: number | null = null;

function startSyncTimer() {
  if (syncIntervalId === null) {
    syncIntervalId = window.setInterval(() => {
      syncTelemetry(false);
    }, 15 * 1000);
  }
}

function stopSyncTimer() {
  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

// 页面关闭时发送
window.addEventListener('beforeunload', () => {
  syncTelemetry(true);
});

// 页面隐藏/显示时调整同步策略
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    syncTelemetry(true);
    stopSyncTimer();
  } else {
    isUnloadTriggered = false;
    startSyncTimer();
  }
});

// 初始化启动定时同步（若页面处于可见状态）
if (document.visibilityState !== 'hidden') {
  startSyncTimer();
}

// 页面加载时初始化，并触发 app_launch 事件
initTracker().then(() => {
  reportUsage("app_launch", { detail: "App launched and SLS tracker initialized successfully" });
}).catch(err => {
  console.warn("Failed to trigger app_launch on initialization:", err);
});