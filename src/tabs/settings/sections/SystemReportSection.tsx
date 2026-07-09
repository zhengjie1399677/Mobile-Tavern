import { useState } from "react";
import { getDB } from "../../../utils/localDB";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import type { ViewportSize } from "../utils";

export interface SystemReportSectionProps extends Pick<UnifiedAppContextProps,
  | "settings" | "safeAreas" | "showCustomAlert" | "getKernelService"
> {
  isTauri: boolean;
  deviceModel: string;
  viewportSize: ViewportSize;
}

export default function SystemReportSection({
  settings,
  safeAreas,
  showCustomAlert,
  getKernelService,
  isTauri,
  deviceModel,
  viewportSize,
}: SystemReportSectionProps) {
  const [diagnoseLog, setDiagnoseLog] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);

  const runSelfCheck = async () => {
    setIsChecking(true);
    let logLines: string[] = [];
    const log = (text: string) => {
      logLines.push(text);
      setDiagnoseLog(logLines.join("\n"));
    };

    const totalStart = Date.now();
    log(`[${new Date().toISOString()}] =================================`);
    log(`[SYSTEM DIAGNOSTIC START]`);
    log(`App Version: v${__APP_VERSION__}`);
    log(`Platform: ${isTauri ? "Tauri Android" : "Web"}`);
    log(`Device: ${deviceModel}`);
    log(`=================================================`);

    // 1. IndexedDB + 各 Store 记录数统计（开发者定位数据膨胀/IDB 损坏问题需要）
    const dbStart = Date.now();
    log(`\n[1. DB] IndexedDB connection & CRUD & record counts...`);
    try {
      const db = await getDB();
      log(`[1. DB] OK: Opened "${db.name}" (v${db.version})`);

      const storeNames = Array.from(db.objectStoreNames) as string[];
      log(`[1. DB] ObjectStores (${storeNames.length}): ${storeNames.join(", ")}`);

      // 各 Store 记录数（判断数据膨胀导致卡顿）
      log(`[1. DB] Record counts:`);
      for (const storeName of storeNames) {
        try {
          const countTx = db.transaction(storeName, "readonly");
          const countStore = countTx.objectStore(storeName);
          const count = await new Promise<number>((resolve, reject) => {
            const req = countStore.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const warnTag = count > 1000 ? " ⚠️ HIGH" : count > 200 ? " (moderate)" : "";
          log(`[1. DB]   - ${storeName}: ${count} records${warnTag}`);
        } catch (err: any) {
          log(`[1. DB]   - ${storeName}: COUNT ERROR (${err.message})`);
        }
      }

      // 写入延迟测试
      const writeStart = Date.now();
      const writeTx = db.transaction(["settings"], "readwrite");
      const writeStore = writeTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ id: "diagnose_transient_key", value: Date.now() }, "diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      const writeLatency = Date.now() - writeStart;
      const writeHealth = writeLatency < 50 ? "EXCELLENT" : writeLatency < 200 ? "GOOD" : "SLOW";
      log(`[1. DB] Write latency: ${writeLatency}ms (${writeHealth})`);

      // 清理临时记录
      const deleteTx = db.transaction(["settings"], "readwrite");
      const deleteStore = deleteTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = deleteStore.delete("diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err: any) {
      log(`[1. DB] ERROR: ${err?.stack || err?.message || err}`);
    }
    log(`[1. DB] Elapsed: ${Date.now() - dbStart}ms`);

    // 2. Native Bridge + 关键方法逐个检查（定位"某原生功能失效"问题）
    const bridgeStart = Date.now();
    log(`\n[2. BRIDGE] Native Webview bridge verification...`);
    const w = window as any;
    if (w.AndroidThemeBridge) {
      log(`[2. BRIDGE] OK: AndroidThemeBridge detected.`);
      const methods = Object.getOwnPropertyNames(w.AndroidThemeBridge).filter((p: string) => typeof w.AndroidThemeBridge[p] === 'function');
      log(`[2. BRIDGE] Methods (${methods.length}): ${methods.join(", ")}`);

      // 关键方法完整性检查
      const criticalBridgeMethods = [
        "getSafeAreas", "setStatusBarStyle",
        "saveFile", "saveFileBase64", "openUrl",
        "speakNative", "stopNative", "isSpeakingNative"
      ];
      const missing = criticalBridgeMethods.filter(m => !methods.includes(m));
      if (missing.length > 0) {
        log(`[2. BRIDGE] WARNING: Missing critical methods: ${missing.join(", ")}`);
      } else {
        log(`[2. BRIDGE] All critical methods present (OK)`);
      }
    } else {
      log(`[2. BRIDGE] WARNING: AndroidThemeBridge undefined (Web environment / not injected).`);
    }
    log(`[2. BRIDGE] Elapsed: ${Date.now() - bridgeStart}ms`);

    // 3. TTS/ASR provider 与桥可用性交叉验证（定位"TTS 不出声/ASR 不识别"问题）
    const speechStart = Date.now();
    log(`\n[3. SPEECH] TTS/ASR provider-availability cross-check...`);
    const hasBridgeTTS = !!(w.AndroidThemeBridge && typeof w.AndroidThemeBridge.speakNative === "function");
    const ttsProvider = settings.ttsConfig?.provider || "speech-synthesis";
    const ttsEnabled = settings.ttsConfig?.enabled;

    if (!ttsEnabled) {
      log(`[3. SPEECH] TTS: disabled (skip)`);
    } else if (ttsProvider === "speech-synthesis") {
      if (hasBridgeTTS) {
        log(`[3. SPEECH] TTS: OK (provider=speech-synthesis, native bridge available)`);
      } else {
        log(`[3. SPEECH] TTS: ERROR (provider=speech-synthesis but native bridge missing! TTS will throw at runtime)`);
      }
    } else if (ttsProvider === "openai") {
      const openaiKey = settings.ttsConfig?.openaiApiKey;
      if (!openaiKey) {
        log(`[3. SPEECH] TTS: WARNING (provider=openai but openaiApiKey empty)`);
      } else {
        log(`[3. SPEECH] TTS: OK (provider=openai, apiKey configured, length=${openaiKey.length})`);
      }
    } else {
      log(`[3. SPEECH] TTS: UNKNOWN provider="${ttsProvider}"`);
    }

    const hasASR = typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
    const asrEnabled = settings.asrConfig?.enabled;
    if (!asrEnabled) {
      log(`[3. SPEECH] ASR: disabled (skip)`);
    } else if (hasASR) {
      log(`[3. SPEECH] ASR: OK (WebSpeech available)`);
    } else {
      log(`[3. SPEECH] ASR: ERROR (enabled but WebSpeech API unavailable in this WebView)`);
    }
    log(`[3. SPEECH] Elapsed: ${Date.now() - speechStart}ms`);

    // 4. Kernel Services - 完整 17 个 + critical 等级（定位"某功能服务未初始化"问题）
    const kernelStart = Date.now();
    log(`\n[4. KERNEL] Micro-kernel services registry (17 services)...`);
    const allServices: { name: string; critical: boolean }[] = [
      { name: "database", critical: true },
      { name: "llm", critical: true },
      { name: "prompt", critical: true },
      { name: "chatStream", critical: true },
      { name: "multiMessage", critical: false },
      { name: "telemetry", critical: false },
      { name: "script", critical: false },
      { name: "memory", critical: false },
      { name: "updateCheck", critical: false },
      { name: "character", critical: false },
      { name: "worldbook", critical: false },
      { name: "settings", critical: false },
      { name: "preset", critical: false },
      { name: "imageGen", critical: false },
      { name: "bgm", critical: false },
      { name: "tts", critical: false },
      { name: "asr", critical: false },
    ];
    let kernelOk = 0;
    let kernelFailed = 0;
    for (const svc of allServices) {
      try {
        const s = getKernelService(svc.name);
        if (s) {
          log(`[4. KERNEL]   ${svc.name}: OK${svc.critical ? " (critical)" : ""}`);
          kernelOk++;
        } else {
          log(`[4. KERNEL]   ${svc.name}: NOT FOUND${svc.critical ? " (CRITICAL!)" : " (warning)"}`);
          kernelFailed++;
        }
      } catch (err: any) {
        log(`[4. KERNEL]   ${svc.name}: ERROR - ${err.message}`);
        kernelFailed++;
      }
    }
    log(`[4. KERNEL] Summary: ${kernelOk}/${allServices.length} initialized, ${kernelFailed} failed`);
    log(`[4. KERNEL] Elapsed: ${Date.now() - kernelStart}ms`);

    // 5. 环境信息 - 存储配额 + 网络状态（定位"IDB 写入失败/LLM 慢"问题）
    const envStart = Date.now();
    log(`\n[5. ENV] Storage quota & network status...`);

    // 存储配额
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const usageMB = (usage / 1024 / 1024).toFixed(2);
        const quotaMB = (quota / 1024 / 1024).toFixed(2);
        const percent = quota > 0 ? ((usage / quota) * 100).toFixed(1) : "N/A";
        const pctNum = parseFloat(String(percent));
        const storageStatus = pctNum > 80 ? "⚠️ CRITICAL (may cause IDB write failure)" : pctNum > 60 ? "⚠️ WARNING" : "OK";
        log(`[5. ENV] Storage: ${usageMB}MB / ${quotaMB}MB (${percent}% used) ${storageStatus}`);
      } catch (err: any) {
        log(`[5. ENV] Storage estimate error: ${err.message}`);
      }
    } else {
      log(`[5. ENV] Storage estimate API unavailable`);
    }

    // 网络状态
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    log(`[5. ENV] Online: ${online ? "YES" : "NO (offline)"}`);
    if (conn) {
      log(`[5. ENV] Connection: type=${conn.effectiveType || "unknown"}, downlink=${conn.downlink || "unknown"}Mbps, rtt=${conn.rtt || "unknown"}ms`);
    } else {
      log(`[5. ENV] Connection API unavailable (desktop / old WebView)`);
    }
    log(`[5. ENV] Elapsed: ${Date.now() - envStart}ms`);

    // 6. LLM API Ping（离线时跳过）
    const llmStart = Date.now();
    log(`\n[6. LLM API] Connection test: ${settings.api?.baseUrl || "https://api.openai.com/v1"}`);
    if (!online) {
      log(`[6. LLM API] SKIP (device offline)`);
    } else if (!settings.api?.apiKey) {
      log(`[6. LLM API] WARNING: apiKey is empty. Remote requests will fail.`);
    } else {
      const maskedKey = settings.api.apiKey.length > 8 ? `${settings.api.apiKey.substring(0, 4)}...${settings.api.apiKey.substring(settings.api.apiKey.length - 4)}` : "***";
      log(`[6. LLM API] apiKey length: ${settings.api.apiKey.length} (${maskedKey}). Type: ${settings.api.type || "openai-compat"}`);
      try {
        const pingStart = Date.now();
        const { universalFetch } = await import("../../../utils/apiClient");
        const response = await universalFetch("/api/test-connection", {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey,
          modelName: settings.api.modelName,
          chatPath: settings.api.chatPath,
          bypassProxy: settings.api.bypassProxy,
          forceBasicParams: settings.api.forceBasicParams,
        });
        const latency = Date.now() - pingStart;
        const status = response.status;

        let data: any = null;
        let rawText = "";
        try {
          rawText = await response.text();
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json") || (rawText.trim().startsWith("{") && rawText.trim().endsWith("}"))) {
            data = JSON.parse(rawText);
          }
        } catch (e: any) {
          // Fallback if reading text fails
        }

        if (response.ok && data?.success) {
          log(`[6. LLM API] OK: HTTP ${status}. Latency: ${latency}ms`);
          log(`[6. LLM API] Message: ${data.message || "Connected"}`);
        } else {
          log(`[6. LLM API] ERROR: HTTP ${status}.`);
          if (data) {
            log(`[6. LLM API] Details: ${data.error || JSON.stringify(data)}`);
          } else {
            const cleanText = rawText.trim();
            const snippet = cleanText.length > 300 ? cleanText.substring(0, 300) + "... [truncated]" : cleanText;
            log(`[6. LLM API] Raw payload: ${snippet || "(empty response)"}`);

            // 诊断提示
            if (status === 502) {
              log(`[6. LLM API] DIAGNOSIS: 502 Bad Gateway. Proxy cannot reach upstream LLM API.`);
            } else if (status === 504) {
              log(`[6. LLM API] DIAGNOSIS: 504 Gateway Timeout. Proxy timed out waiting for upstream.`);
            } else if (status === 403) {
              log(`[6. LLM API] DIAGNOSIS: 403 Forbidden. Rejected by Cloudflare/firewall/CORS/credentials.`);
            } else if (status === 404) {
              log(`[6. LLM API] DIAGNOSIS: 404 Not Found. Verify baseUrl and endpoint paths.`);
            }
          }
        }
      } catch (err: any) {
        log(`[6. LLM API] ERROR: Ping failed.`);
        log(`[6. LLM API] Details: ${err?.stack || err?.message || err}`);
      }
    }
    log(`[6. LLM API] Elapsed: ${Date.now() - llmStart}ms`);

    const totalElapsed = Date.now() - totalStart;
    log(`\n=================================================`);
    log(`[DIAGNOSTIC COMPLETE] Total elapsed: ${totalElapsed}ms`);
    log(`=================================================`);
    setIsChecking(false);
  };

  return (
    <div className="mt-6 text-center space-y-1 pb-4 select-text font-mono text-[9px] text-muted-foreground/80">
      <p className="font-bold text-[10px] text-muted-foreground mb-1 select-none flex items-center justify-center gap-1">
        🛠️ 系统报告
        <button
          onClick={() => {
            const reportText = [
              `当前版本: v${__APP_VERSION__}`,
              `运行平台: ${isTauri ? "Tauri Android 客户端" : "Web 网页端"}`,
              `设备型号: ${deviceModel}`,
              typeof window !== "undefined" ? `视口尺寸: ${viewportSize.w}x${viewportSize.h} (视觉: ${Math.round(viewportSize.vW)}x${Math.round(viewportSize.vH)})` : null,
              safeAreas ? `安全区域: 顶部 ${safeAreas.top}dp | 底部 ${safeAreas.bottom}dp` : null,
              `安卓桥接: ${typeof window !== "undefined" && (window as any).AndroidThemeBridge ? "已注入 (Success)" : "未注入/不支持 (None)"}`,
              `UA 信息: ${typeof navigator !== "undefined" ? navigator.userAgent : "N/A"}`,
              `TTS 配置: ${settings.ttsConfig?.enabled ? `开启 (${settings.ttsConfig.provider || "speech-synthesis"})` : "关闭"}`,
              `ASR 配置: ${settings.asrConfig?.enabled ? `开启 (${settings.asrConfig.provider || "web-speech"})` : "关闭"}`,
              `生图配置: ${settings.imageGenApi?.enabled ? `开启 (${settings.imageGenApi.type || "openai-dalle"})` : "关闭"}`,
              `主 API 接口: ${settings.api?.baseUrl ? `已配 (Base: ${settings.api.baseUrl.replace(/^(https?:\/\/[^\/]+).*$/, "$1")}...)` : "未配置"}`
            ].filter(Boolean).join("\n");

            let copyText = reportText;
            if (diagnoseLog) {
              copyText += `\n\n=================================\n🛠️ 系统自检诊断日志 (DEBUGLOG)\n=================================\n${diagnoseLog}`;
            }

            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(copyText);
            } else {
              const textarea = document.createElement("textarea");
              textarea.value = copyText;
              document.body.appendChild(textarea);
              textarea.select();
              try {
                document.execCommand("copy");
              } catch (_) {}
              document.body.removeChild(textarea);
            }
            showCustomAlert(diagnoseLog ? "系统报告及自检日志已成功复制到剪贴板！" : "系统报告已成功复制到剪贴板！", "复制成功");
          }}
          className="text-[9px] text-primary hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-primary/20 rounded bg-primary/5 hover:bg-primary/10 ml-1.5 active:scale-95 transition-all"
        >
          复制报告
        </button>
        <button
          onClick={runSelfCheck}
          disabled={isChecking}
          className="text-[9px] text-emerald-500 hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-emerald-500/20 rounded bg-emerald-500/5 hover:bg-emerald-500/10 ml-1 active:scale-95 transition-all disabled:opacity-55"
        >
          {isChecking ? "自检中..." : "开始自检"}
        </button>
      </p>
      <p className="opacity-55">
        当前版本: v{__APP_VERSION__} • 运行平台: {isTauri ? "Tauri Android 客户端" : "Web 网页端"}
      </p>
      <p className="opacity-55">
        设备型号: {deviceModel}
      </p>
      {typeof window !== "undefined" && (
        <p className="opacity-55">
          视口尺寸: {viewportSize.w}x{viewportSize.h} (视觉: {Math.round(viewportSize.vW)}x${Math.round(viewportSize.vH)})
        </p>
      )}
      {safeAreas && (
        <p className="opacity-55">
          安全区域: 顶部 {safeAreas.top}dp | 底部 {safeAreas.bottom}dp
        </p>
      )}

      {diagnoseLog && (
        <div className="mt-3 text-left p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-lg text-zinc-300 font-sans tracking-wide overflow-x-auto max-w-full shadow-inner leading-relaxed">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1.5 text-[8px] font-bold text-zinc-500 select-none">
            <span>🛠️ 系统自检诊断日志 (DEBUGLOG)</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(diagnoseLog);
                  }
                  showCustomAlert("自检日志已成功复制到剪贴板！", "复制成功");
                }}
                className="text-primary hover:underline text-[8px]"
              >
                [复制日志]
              </button>
              <button
                onClick={() => setDiagnoseLog("")}
                className="text-zinc-500 hover:text-zinc-400 text-[8px]"
              >
                [清除]
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300">{diagnoseLog}</pre>
        </div>
      )}
    </div>
  );
}
