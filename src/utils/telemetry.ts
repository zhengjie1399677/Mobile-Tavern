import { invoke } from '@tauri-apps/api/core';

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
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Unknown",
    language: typeof navigator !== "undefined" ? navigator.language : "zh-CN",
    platform: typeof navigator !== "undefined" ? navigator.platform : "Unknown",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

let sessionStartTime = Date.now();

function buildLog(action: string, extraData: Record<string, any> = {}) {
  const deviceInfo = getDeviceInfo();
  const eventDurMs = Math.max(0, Date.now() - sessionStartTime);
  
  return {
    action: action,
    device_id: deviceInfo.deviceId,
    player_name: String(extraData.playerName || "未知"),
    character_name: String(extraData.characterName || "未知"),
    model: String(extraData.modelName || extraData.model || ""),
    tokens_used: String(extraData.totalTokens || extraData.tokens_used || "0"),
    generation_time_ms: String(Math.round(extraData.generationTime || extraData.generation_time_ms || 0)),
    detail: String(extraData.detail || ""),
    session_id: String(extraData.sessionId || "无"),
    session_start_time: new Date(sessionStartTime).toLocaleString(),
    session_duration_sec: String(Math.round(eventDurMs / 1000)),
    platform: "Tauri",
    user_agent: deviceInfo.userAgent,
    language: deviceInfo.language,
    timezone: deviceInfo.timeZone
  };
}

async function sendTelemetryToRust(log: any) {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  if (isTauri) {
    try {
      await invoke('report_telemetry', { log });
    } catch (err) {
      console.warn("[Telemetry] Failed to invoke report_telemetry command:", err);
    }
  } else {
    console.log("[Telemetry] [Mock Dev Send]:", log);
  }
}

export function incrementUsageCount() {
  // Usage count dummy
}

export function reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}) {
  const log = buildLog(action, extraData);
  sendTelemetryToRust(log);
}

// ========== 遥测增强高级接口 ==========

export async function reportColdStartReady() {
  const duration = Date.now() - sessionStartTime;
  try {
    await reportImmediate("app_instant_launch", { detail: "应用启动，立刻上报瞬时遥测，绕过离线缓存" });
  } catch (e) {
    console.warn("Failed to send app_instant_launch telemetry:", e);
  }
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
    generationTime: durationMs,
    detail: `TTFT: ${ttftMs}ms, Duration: ${durationMs}ms, PromptTokens: ${promptTokens}, CompletionTokens: ${completionTokens}`
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

/**
 * 绕过任何本地离线缓存队列，立刻将一条遥测日志通过网络发送出去。
 */
export async function reportImmediate(action: string, extraData: Record<string, any> = {}) {
  const log = buildLog(action, extraData);
  await sendTelemetryToRust(log);
}

// Cold Start Detection and Replay logic on load
(() => {
  if (typeof window !== "undefined") {
    (window as any).reportZodValidationError = reportZodValidationError;
  }
})();