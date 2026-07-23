import { useState } from "react";
import { getDB } from "../../../utils/localDB";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import type { ViewportSize } from "../utils";
import { useTranslation } from "../../../contexts/LanguageContext";
import { getViewportSnapshot, getViewportHistory, getViewportMeta, measureDynamicViewportHeight } from "../../../utils/viewportDiagnostic";

/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本文件实际使用的方法子集）。
 * 字段全部可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface AndroidThemeBridge {
  getSafeAreas?: () => string;
  setStatusBarStyle?: (isDark: boolean, color: string) => void;
  saveFile?: (fileName: string, content: string) => string;
  saveFileBase64?: (fileName: string, base64Data: string, mimeType: string) => string;
  openUrl?: (url: string) => void;
  speakNative?: (text: string) => void;
  stopNative?: () => void;
  isSpeakingNative?: () => boolean;
  // 允许通过 Object.getOwnPropertyNames 枚举方法名
  [key: string]: unknown;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge 与 WebSpeech API。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/**
 * 网络信息 API 的最小子集类型（NetworkInformation 在部分 WebView 中不可用）。
 */
interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

/**
 * 扩展 Navigator 以访问非标准的网络信息 API（带浏览器前缀）。
 */
interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
}

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
  const { t } = useTranslation();
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
    const w = window as WindowWithAndroidBridge;
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
    const conn = (navigator as NavigatorWithConnection).connection || (navigator as NavigatorWithConnection).mozConnection || (navigator as NavigatorWithConnection).webkitConnection;
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

    // 7. 视口/键盘诊断（定位"小键盘遮挡输入框"等瞬态问题，含黑匣子事件历史）
    const viewportStart = Date.now();
    log(`\n[7. VIEWPORT] Viewport & keyboard diagnostic (black-box history)...`);
    log(`[7. VIEWPORT] meta: ${getViewportMeta()}`);
    const snap = getViewportSnapshot();
    log(`[7. VIEWPORT] window: ${snap.innerW}x${snap.innerH}`);
    log(`[7. VIEWPORT] visualViewport: ${snap.hasVisualViewport ? `${snap.vvpW}x${snap.vvpH} (offsetTop=${snap.vvpOffsetTop}, scale=${snap.vvpScale})` : "UNAVAILABLE (no visualViewport API)"}`);
    const dvh = measureDynamicViewportHeight();
    const dvhMismatch = dvh !== null && dvh !== snap.innerH;
    log(`[7. VIEWPORT] 100dvh measured: ${dvh ?? "N/A"}px (vs innerH=${snap.innerH}px${dvhMismatch ? " ⚠️ MISMATCH" : " match"})`);
    const history = getViewportHistory();
    log(`[7. VIEWPORT] Resize event history (${history.length} records, oldest→newest):`);
    for (const r of history) {
      const t = new Date(r.time).toISOString().split("T")[1].replace("Z", "");
      const vvpStr = r.vvpH !== null ? `${r.vvpW}x${r.vvpH} off=${r.vvpOffsetTop} scale=${r.vvpScale}` : "no-vvp";
      log(`[7. VIEWPORT]   ${t} [${r.source}] win=${r.innerW}x${r.innerH} vvp=${vvpStr}`);
    }
    // 自动诊断提示：判定 keyboard avoidance 事件通道健康度
    const hasVvpResize = history.some(r => r.source === "visualViewport");
    const hasWinResize = history.some(r => r.source === "window");
    if (history.length > 1 && hasWinResize && !hasVvpResize) {
      log(`[7. VIEWPORT] DIAGNOSIS: window.resize fired but visualViewport.resize NEVER fired.`);
      log(`[7. VIEWPORT]   → interactive-widget=resizes-content 下 vvp.resize 缺失，容器高度需同时监听 window.resize。`);
    } else if (history.length > 1 && hasVvpResize && !hasWinResize) {
      log(`[7. VIEWPORT] DIAGNOSIS: visualViewport.resize fired but window.resize NEVER fired.`);
      log(`[7. VIEWPORT]   → overlays-content 模式典型特征，offsetTop 应在键盘弹出时增大。`);
    }
    log(`[7. VIEWPORT] Elapsed: ${Date.now() - viewportStart}ms`);

    const totalElapsed = Date.now() - totalStart;
    log(`\n=================================================`);
    log(`[DIAGNOSTIC COMPLETE] Total elapsed: ${totalElapsed}ms`);
    log(`=================================================`);
    setIsChecking(false);
  };

  return (
    <div className="mt-6 text-center space-y-1 pb-4 select-text font-mono text-[9px] text-muted-foreground/80">
      <p className="font-bold text-[10px] text-muted-foreground mb-1 select-none flex items-center justify-center gap-1">
        🛠️ {t("report.title")}
        <button
          onClick={() => {
            const reportText = [
              `${t("report.version")}: v${__APP_VERSION__}`,
              `${t("report.platform")}: ${isTauri ? t("report.android_client") : t("report.web_client")}`,
              `${t("report.device")}: ${deviceModel}`,
              typeof window !== "undefined" ? `${t("report.viewport")}: ${viewportSize.w}x${viewportSize.h} (visual: ${Math.round(viewportSize.vW)}x${Math.round(viewportSize.vH)})` : null,
              typeof window !== "undefined" && window.visualViewport ? `visualViewport: ${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)} offsetTop=${Math.round(window.visualViewport.offsetTop)} scale=${window.visualViewport.scale?.toFixed(2)}` : null,
              safeAreas ? `${t("report.safe_area")}: ${safeAreas.top}dp | ${safeAreas.bottom}dp` : null,
              `${t("report.android_bridge")}: ${typeof window !== "undefined" && (window as WindowWithAndroidBridge).AndroidThemeBridge ? t("report.success") : t("report.none")}`,
              `${t("report.ua")}: ${typeof navigator !== "undefined" ? navigator.userAgent : "N/A"}`,
              `${t("report.tts")}: ${settings.ttsConfig?.enabled ? `${t("report.enabled")} (${settings.ttsConfig.provider || "speech-synthesis"})` : t("report.disabled")}`,
              `${t("report.asr")}: ${settings.asrConfig?.enabled ? `${t("report.enabled")} (${settings.asrConfig.provider || "web-speech"})` : t("report.disabled")}`,
              `${t("report.image_gen")}: ${settings.imageGenApi?.enabled ? `${t("report.enabled")} (${settings.imageGenApi.type || "openai-dalle"})` : t("report.disabled")}`,
              `${t("report.api_endpoint")}: ${settings.api?.baseUrl ? `${t("report.configured")} (Base: ${settings.api.baseUrl.replace(/^(https?:\/\/[^\/]+).*$/, "$1")}...)` : t("report.not_configured")}`
            ].filter(Boolean).join("\n");

            let copyText = reportText;
            if (diagnoseLog) {
              copyText += `\n\n=================================\n🛠️ ${t("report.title")} DEBUGLOG\n=================================\n${diagnoseLog}`;
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
            showCustomAlert(diagnoseLog ? t("report.copied_all") : t("report.copied_basic"), t("report.copy_success"));
          }}
          className="text-[9px] text-primary hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-primary/20 rounded bg-primary/5 hover:bg-primary/10 ml-1.5 active:scale-95 transition-all"
        >
          {t("report.copy")}
        </button>
        <button
          onClick={runSelfCheck}
          disabled={isChecking}
          className="text-[9px] text-emerald-500 hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-emerald-500/20 rounded bg-emerald-500/5 hover:bg-emerald-500/10 ml-1 active:scale-95 transition-all disabled:opacity-55"
        >
          {isChecking ? t("report.checking") : t("report.check_start")}
        </button>
      </p>
      <p className="opacity-55">
        {t("report.version")}: v{__APP_VERSION__} • {t("report.platform")}: {isTauri ? t("report.android_client") : t("report.web_client")}
      </p>
      <p className="opacity-55">
        {t("report.device")}: {deviceModel}
      </p>
      {typeof window !== "undefined" && (
        <p className="opacity-55">
          {t("report.viewport")}: {viewportSize.w}x{viewportSize.h} (visual: {Math.round(viewportSize.vW)}x{Math.round(viewportSize.vH)})
        </p>
      )}
      {safeAreas && (
        <p className="opacity-55">
          {t("report.safe_area")}: {safeAreas.top}dp | {safeAreas.bottom}dp
        </p>
      )}

      {diagnoseLog && (
        <div className="mt-3 text-left p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-lg text-zinc-300 font-sans tracking-wide overflow-x-auto max-w-full shadow-inner leading-relaxed">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1.5 text-[8px] font-bold text-zinc-500 select-none">
            <span>🛠️ {t("report.title")} DEBUGLOG</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(diagnoseLog);
                  }
                  showCustomAlert(t("report.copied_log"), t("report.copy_success"));
                }}
                className="text-primary hover:underline text-[8px]"
              >
                [{t("report.copy")}]
              </button>
              <button
                onClick={() => setDiagnoseLog("")}
                className="text-zinc-500 hover:text-zinc-400 text-[8px]"
              >
                [clear]
              </button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300">{diagnoseLog}</pre>
        </div>
      )}
    </div>
  );
}
