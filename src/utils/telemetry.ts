import SlsTracker from '@aliyun-sls/web-track-browser';
import createStsPlugin from '@aliyun-sls/web-sts-plugin';

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
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
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

// Global memory queue for telemetry events
let pendingEvents: TelemetryEvent[] = [];
const STORAGE_QUEUE_KEY = "telemetry_pending_queue";
const ACTIVE_SESSION_KEY = "app_session_active";

// Safely load offline events on startup
try {
  const cachedQueue = localStorage.getItem(STORAGE_QUEUE_KEY);
  if (cachedQueue) {
    pendingEvents = JSON.parse(cachedQueue);
    console.log(`[Telemetry] Loaded ${pendingEvents.length} cached events from local storage`);
  }
} catch (e) {
  console.warn("Failed to load telemetry cache:", e);
}

// Safely save offline events to disk
function persistEvents() {
  try {
    localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(pendingEvents));
  } catch (e) {
    console.warn("Failed to save telemetry cache:", e);
  }
}

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

  // Auto persist to localStorage immediately (0-loss on unexpected kill)
  persistEvents();

  // 每 2 个事件或页面关闭时同步
  if (action === "app_close" || pendingEvents.length >= 2) {
    syncTelemetry(action === "app_close");
  }
}

// ========== 遥测增强高级接口 ==========

export function reportColdStartReady() {
  const duration = Date.now() - sessionStartTime;
  reportUsage("performance_cold_start", {
    detail: "App cold start ready",
    generationTime: duration,
  });
}

export function reportChatLoadTime(durationMs: number) {
  reportUsage("performance_chat_load", {
    detail: "Chat session load completed",
    generationTime: durationMs,
  });
}

export function reportLlmPerformance(
  sessionId: string,
  modelName: string,
  ttftMs: number,
  totalTokens: number,
  durationMs: number,
  promptTokens: number,
  completionTokens: number
) {
  reportUsage("llm_performance", {
    sessionId,
    modelName,
    totalTokens,
    promptTokens,
    completionTokens,
    generationTime: durationMs,
    detail: `TTFT: ${ttftMs}ms, Duration: ${durationMs}ms, Speed: ${(completionTokens / (durationMs / 1000)).toFixed(2)} t/s`
  });
}

export function reportDbQueueTimeout(queueDelayMs: number, queueLength: number) {
  reportUsage("db_queue_timeout", {
    detail: `DB WriteQueue delayed. Delay: ${queueDelayMs}ms, Queue Length: ${queueLength}`,
    generationTime: queueDelayMs,
  });
}

export function reportZodValidationError(errorDetail: string, path: string, inputVal: any) {
  reportUsage("mvu_zod_validation_error", {
    detail: `Zod Error: ${errorDetail} at path: ${path}, input: ${JSON.stringify(inputVal)}`
  });
}

// ========== SLS SDK 初始化 ==========

const SLS_NOISE_PATTERNS = [
  'Failed to log to ali log service',
  'Failed log data',
  'Failed logdata',
];

function isSLSNoise(args: any[]): boolean {
  return typeof args[0] === 'string' && SLS_NOISE_PATTERNS.some(p => args[0].includes(p));
}

let tracker: SlsTracker | null = null;
let stsPlugin: any = null;
let stsRefreshTimer: number | null = null;
let isSyncing = false;

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

    const slsProject = credentials.SlsProject || project;
    const slsEndpoint = credentials.SlsEndpoint || endpoint;
    const slsLogstore = credentials.SlsLogstore || logstore;

    if (!slsProject || !slsEndpoint || !slsLogstore) {
      throw new Error("缺少 SLS 配置");
    }

    tracker = new SlsTracker({
      host: slsEndpoint.replace(/^https?:\/\//, ''),
      project: slsProject,
      logstore: slsLogstore,
      time: 10,
      count: 10,
    });

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

    const expirationTime = credentials.Expiration 
      ? new Date(credentials.Expiration).getTime() 
      : Date.now() + 60 * 60 * 1000;
    
    const refreshTime = expirationTime - Date.now() - 5 * 60 * 1000;
    
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
    if (!tracker || !stsPlugin) {
      await initTracker();
    }

    if (!stsPlugin) {
      throw new Error("STS Plugin 未初始化");
    }

    const project = import.meta.env.VITE_ALIYUN_SLS_PROJECT || (tracker as any)?.getOpt?.().project;
    const endpoint = import.meta.env.VITE_ALIYUN_SLS_ENDPOINT || (tracker as any)?.getOpt?.().host;
    const logstore = import.meta.env.VITE_ALIYUN_SLS_LOGSTORE || (tracker as any)?.getOpt?.().logstore;

    if (!project || !endpoint || !logstore) {
      throw new Error("缺少 SLS 配置信息");
    }

    const host = endpoint.replace(/^https?:\/\//, '');
    const url = `https://${project}.${host}/logstores/${logstore}`;
    const bodyPayload = JSON.stringify({ __logs__: slsLogs });

    const { data: requestBody, header: requestHeaders } = await stsPlugin.process(url, bodyPayload);

    const res = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
      keepalive: isUnloading,
    });

    if (!res.ok) {
      const responseText = await res.text();
      throw new Error(`SLS Response Error: ${res.status} ${responseText}`);
    }

    console.log(`已成功发送 ${slsLogs.length} 条日志至阿里云 SLS (${isUnloading ? 'unload' : 'batch'})`);

    // Only filter out successfully sent events to prevent silent data loss
    pendingEvents = pendingEvents.filter(e => !eventsToSend.includes(e));
    
    // Sync the updated queue back to localStorage
    persistEvents();

  } catch (err: any) {
    if (!isSLSNoise([err?.message || String(err)])) {
      console.warn("Telemetry sync 失败，保留本地队列待下次同步:", err);
    }
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

// Session active heartbeat management helpers
function markSessionActive() {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, "true");
  } catch (e) {}
}

function clearSessionActive() {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, "false");
  } catch (e) {}
}

window.addEventListener('beforeunload', () => {
  clearSessionActive();
  syncTelemetry(true);
});

window.addEventListener('pagehide', () => {
  clearSessionActive();
  syncTelemetry(true);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    clearSessionActive();
    syncTelemetry(true);
    stopSyncTimer();
  } else {
    isUnloadTriggered = false;
    markSessionActive();
    startSyncTimer();
  }
});

if (document.visibilityState !== 'hidden') {
  startSyncTimer();
}

// Cold Start Detection and Replay logic on load
(async () => {
  if (typeof window !== "undefined") {
    (window as any).reportZodValidationError = reportZodValidationError;
  }

  // 1. Detect abnormal termination
  try {
    const lastSessionActive = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (lastSessionActive === "true") {
      console.warn("[Telemetry] Detected abnormal termination from previous session!");
      reportUsage("app_abnormal_termination", { detail: "上一次运行发生了异常大退或闪退（session 标志未正常清理）" });
    }
  } catch (e) {}

  // 2. Refresh active session flag for current boot
  markSessionActive();

  // 3. Init tracker & perform cold boot replay
  try {
    await initTracker();
    // Cold launch notification
    reportUsage("app_launch", { detail: "App launched and SLS tracker initialized successfully" });
    // Trigger immediate sync for both launch event and any replayed cached events
    await syncTelemetry(false);
  } catch (err) {
    console.warn("Failed during telemetry init / cold replay:", err);
  }
})();