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
let eventCount = 0;
let totalSessionTokens = 0;

interface TelemetryEvent {
  action: string;
  timestamp: number;
  extraData?: Record<string, any>;
}

let pendingEvents: TelemetryEvent[] = [];

export function incrementUsageCount() {
  eventCount++;
}

export function reportUsage(action: string = "app_launch", extraData: Record<string, any> = {}) {
  const project = import.meta.env.VITE_ALIYUN_SLS_PROJECT;
  const endpoint = import.meta.env.VITE_ALIYUN_SLS_ENDPOINT;
  const logstore = import.meta.env.VITE_ALIYUN_SLS_LOGSTORE;

  // Fallback to legacy FC endpoint if SLS is not completely configured
  const fcEndpoint = import.meta.env.VITE_ALIYUN_FC_ENDPOINT;
  
  if (!project && !fcEndpoint) {
    return;
  }

  if (extraData.totalTokens) {
    totalSessionTokens += extraData.totalTokens;
  }

  pendingEvents.push({
    action,
    timestamp: Date.now(),
    extraData
  });

  // Decide if we should sync immediately
  if (action === "app_close") {
    syncTelemetry(true);
  } else if (pendingEvents.length >= 2) { // sync every 2 actions for faster feedback
    syncTelemetry(false);
  }
}

import SlsTracker from '@aliyun-sls/web-track-browser';
import createStsPlugin from '@aliyun-sls/web-sts-plugin';

let trackerInstance: any = null;
let useServerProxy = true; // Use server-side proxy to bypass Web Tracking API restrictions

async function getTrackerInstance() {
  return null; // Force null to always use server proxy
}

async function syncTelemetry(isUnloading: boolean) {
  if (pendingEvents.length === 0) return;

  const eventsToSend = [...pendingEvents];
  pendingEvents = []; // clear local queue

  const fcEndpoint = import.meta.env.VITE_ALIYUN_FC_ENDPOINT;
  const deviceInfo = getDeviceInfo();
  const sessionDur = Date.now() - sessionStartTime;

  try {
    const slsTracker = await getTrackerInstance();
    
    // Default SLS structure shared by both Tracker and /api/proxy/sls
    const slsLogs = eventsToSend.map((evt) => {
      const extra = evt.extraData || {};
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
        session_duration_sec: String(Math.round(sessionDur / 1000)), 
        device_id: String(deviceInfo.deviceId), 
        os_platform: String(deviceInfo.platform), 
        user_agent: String(deviceInfo.userAgent), 
        browser_language: String(deviceInfo.language), 
        client_timezone: String(deviceInfo.timeZone), 
      };
    });

    if (slsTracker) {
      // ===== Direct Browser to SLS using STS Token =====
      for (const log of slsLogs) {
        if (typeof slsTracker.sendImmediate === 'function') {
           slsTracker.sendImmediate(log);
        } else if (typeof slsTracker.send === 'function') {
           slsTracker.send(log);
        } else if (typeof slsTracker.addLog === 'function') {
           slsTracker.addLog(log);
        } else {
           console.error('SLS tracker has no valid send method:', slsTracker);
        }
      }
    } else if (useServerProxy) {
      // ===== Direct POST to local proxy =====
      const payload = {
        __logs__: slsLogs,
        __source__: "web-client",
        __tags__: { platform: deviceInfo.platform }
      };

      if (isUnloading && navigator.sendBeacon) {
        navigator.sendBeacon("/api/proxy/sls", JSON.stringify({ payload }));
      } else {
        const proxyRes = await fetch("/api/proxy/sls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
          keepalive: isUnloading
        });
        if (!proxyRes.ok) {
           console.warn("Proxy telemetry returned non-ok status:", proxyRes.status);
           if (proxyRes.status === 400) {
             useServerProxy = false;
           }
        }
      }
    } else if (fcEndpoint) {
      // ===== Legacy Aliyun FC Approach =====
      const payload = {
        ...deviceInfo,
        sessionStartTime,
        sessionDurationMs: sessionDur,
        eventCount,
        totalSessionTokens,
        events: eventsToSend
      };

      if (isUnloading && navigator.sendBeacon) {
        navigator.sendBeacon(fcEndpoint, JSON.stringify(payload));
      } else {
        await fetch(fcEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: isUnloading 
        });
      }
    }
  } catch (err) {
    console.warn("Telemetry sync issue:", err);
    // Put back on queue if failed
    if (!isUnloading) {
      pendingEvents = [...eventsToSend, ...pendingEvents];
    }
  }
}

// Periodic sync every 15 seconds to ensure we don't drop events
setInterval(() => {
  syncTelemetry(false);
}, 15 * 1000);
