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

    log(`[${new Date().toISOString()}] =================================`);
    log(`[SYSTEM DIAGNOSTIC START] Running local environment verification...`);
    log(`=================================================`);

    // 1. IndexedDB Test
    log(`\n[DB] Testing IndexedDB connection and write-ahead CRUD...`);
    try {
      const db = await getDB();
      log(`[DB] SUCCESS: IndexedDB opened. DB: ${db.name} (v${db.version})`);
      log(`[DB] ObjectStores: ${Array.from(db.objectStoreNames).join(", ")}`);
      
      const writeStart = Date.now();
      const writeTx = db.transaction(["settings"], "readwrite");
      const writeStore = writeTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = writeStore.put({ id: "diagnose_transient_key", value: Date.now() }, "diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      const writeLatency = Date.now() - writeStart;
      log(`[DB] SUCCESS: Transient record written. Latency: ${writeLatency}ms`);

      const deleteTx = db.transaction(["settings"], "readwrite");
      const deleteStore = deleteTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = deleteStore.delete("diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      log(`[DB] SUCCESS: Transient record deleted.`);
      log(`[DB] Database health: EXCELLENT`);
    } catch (err: any) {
      log(`[DB] ERROR: Database operation failed!`);
      log(`[DB] Details: ${err?.stack || err?.message || err}`);
    }

    // 2. Native Bridge Check
    log(`\n[BRIDGE] Verifying Native Webview bridge interfaces...`);
    const w = window as any;
    if (w.AndroidThemeBridge) {
      log(`[BRIDGE] SUCCESS: window.AndroidThemeBridge detected.`);
      const methods = Object.getOwnPropertyNames(w.AndroidThemeBridge).filter((p: string) => typeof w.AndroidThemeBridge[p] === 'function');
      log(`[BRIDGE] Available methods: ${methods.join(", ")}`);
    } else {
      log(`[BRIDGE] WARNING: window.AndroidThemeBridge is undefined.`);
      log(`[BRIDGE] Status: Standard browser web environment (Simulated mode). APK features disabled.`);
    }

    // 3. Audio & Speech engines
    log(`\n[SPEECH] Checking native TTS bridge and Speech Recognition engines...`);
    const hasTTS = typeof window !== "undefined" &&
      !!(window as any).AndroidThemeBridge &&
      typeof (window as any).AndroidThemeBridge.speakNative === "function";
    const hasASR = typeof window !== "undefined" && (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);
    log(`[SPEECH] TTS (Android Native Bridge): ${hasTTS ? "SUPPORTED (OK)" : "UNSUPPORTED (ERROR: native bridge missing)"}`);
    log(`[SPEECH] ASR (SpeechRecognition): ${hasASR ? "SUPPORTED (OK)" : "UNSUPPORTED (WARNING: WebSpeech recognition unavailable)"}`);

    // 4. Kernel Services
    log(`\n[KERNEL] Checking micro-kernel services registry...`);
    const coreServices = ["database", "memory", "bgm", "tts", "asr", "updateCheck"];
    for (const name of coreServices) {
      try {
        const s = getKernelService(name);
        if (s) {
          log(`[KERNEL] Service "${name}": INITIALIZED (OK)`);
        } else {
          log(`[KERNEL] Service "${name}": NOT FOUND (WARNING)`);
        }
      } catch (err: any) {
        log(`[KERNEL] Service "${name}": RESOLUTION ERROR: ${err.message}`);
      }
    }

    // 5. LLM API Ping
    log(`\n[LLM API] Testing connection endpoint: ${settings.api?.baseUrl || "https://api.openai.com/v1"}`);
    if (!settings.api?.apiKey) {
      log(`[LLM API] WARNING: apiKey is empty. Remote requests will fail.`);
    } else {
      const maskedKey = settings.api.apiKey.length > 8 ? `${settings.api.apiKey.substring(0, 4)}...${settings.api.apiKey.substring(settings.api.apiKey.length - 4)}` : "***";
      log(`[LLM API] apiKey length: ${settings.api.apiKey.length} (${maskedKey}). Type: ${settings.api.type || "openai-compat"}`);
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
          log(`[LLM API] SUCCESS: Connection verified. HTTP ${status}. Latency: ${latency}ms`);
          log(`[LLM API] Message: ${data.message || "Connected"}`);
        } else {
          log(`[LLM API] ERROR: Connection failed with HTTP status ${status}.`);
          if (data) {
            log(`[LLM API] Details: ${data.error || JSON.stringify(data)}`);
          } else {
            const cleanText = rawText.trim();
            const snippet = cleanText.length > 300 ? cleanText.substring(0, 300) + "... [truncated]" : cleanText;
            log(`[LLM API] Raw response payload: ${snippet || "(empty response)"}`);
            
            // Standard relay diagnostics guidance
            if (status === 502) {
              log(`[LLM API] DIAGNOSIS: 502 Bad Gateway. The proxy server is running, but it cannot connect to the target LLM upstream API. (e.g. proxy server network issue, target API block, or upstream downtime)`);
            } else if (status === 504) {
              log(`[LLM API] DIAGNOSIS: 504 Gateway Timeout. The proxy server timed out waiting for the target LLM upstream API to respond.`);
            } else if (status === 403) {
              log(`[LLM API] DIAGNOSIS: 403 Forbidden. The request was rejected by Cloudflare, local firewall CORS, or credentials restriction.`);
            } else if (status === 404) {
              log(`[LLM API] DIAGNOSIS: 404 Not Found. The endpoint URL path might be incorrect. Please verify base URL and endpoint paths.`);
            }
          }
        }
      } catch (err: any) {
        log(`[LLM API] ERROR: Ping request failed.`);
        log(`[LLM API] Details: ${err?.stack || err?.message || err}`);
      }
    }

    log(`\n=================================================`);
    log(`[SYSTEM DIAGNOSTIC COMPLETE] All tests executed.`);
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
