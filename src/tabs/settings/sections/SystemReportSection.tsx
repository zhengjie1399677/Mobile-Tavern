import { useState } from "react";
import { getDB } from "../../../utils/localDB";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";
import type { ViewportSize } from "../utils";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  getViewportSnapshot,
  getViewportHistory,
  getViewportMeta,
  measureDynamicViewportHeight,
  estimateKeyboardState,
  checkActiveElementOcclusion,
} from "../../../utils/viewportDiagnostic";

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
  getActiveInputMethod?: () => string;
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

/** performance.memory 的最小子集（仅 Chromium 系 WebView 暴露）。 */
interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

export interface SystemReportSectionProps extends Pick<UnifiedAppContextProps,
  | "settings" | "safeAreas" | "showCustomAlert" | "getKernelService"
> {
  isTauri: boolean;
  deviceModel: string;
  viewportSize: ViewportSize;
}

/** 单个诊断项的结构化结果，用于分块渲染与"只复制出错项"。 */
interface DiagnosticSection {
  /** 项标识，如 "DB"、"VIEWPORT"。 */
  id: string;
  /** 显示标题，如 "1. DB"。 */
  title: string;
  /** 该项所有日志行（含标题行）。 */
  lines: string[];
  /** 该项是否包含 ERROR 级别行。 */
  hasError: boolean;
  /** 该项是否包含 WARNING 级别行。 */
  hasWarning: boolean;
}

/** 判定一行日志是否为 ERROR 级别。 */
function isErrorLine(line: string): boolean {
  return /\bERROR\b|\bCRITICAL\b/i.test(line);
}

/** 判定一行日志是否为 WARNING 级别。 */
function isWarningLine(line: string): boolean {
  return /\bWARNING\b|⚠️|⚠|\bmoderate\b|\bHIGH\b/i.test(line);
}

/** 将文本写入剪贴板，优先用现代 API，回落到 execCommand。 */
function writeClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch (_) {
    // 忽略复制失败
  }
  document.body.removeChild(textarea);
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
  const [sections, setSections] = useState<DiagnosticSection[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const runSelfCheck = async () => {
    setIsChecking(true);
    const allLines: string[] = [];
    const sectionList: DiagnosticSection[] = [];
    let currentSecId = "";
    let currentSecTitle = "";
    let currentSecLines: string[] = [];

    const flushSection = () => {
      if (!currentSecId) return;
      sectionList.push({
        id: currentSecId,
        title: currentSecTitle,
        lines: [...currentSecLines],
        hasError: currentSecLines.some(isErrorLine),
        hasWarning: currentSecLines.some(isWarningLine),
      });
      currentSecId = "";
      currentSecTitle = "";
      currentSecLines = [];
    };

    const startSection = (id: string, title: string) => {
      flushSection();
      currentSecId = id;
      currentSecTitle = title;
      currentSecLines = [];
      const header = `\n[${title}]`;
      allLines.push(header);
      currentSecLines.push(header);
      setDiagnoseLog([...allLines].join("\n"));
    };

    const log = (text: string) => {
      allLines.push(text);
      currentSecLines.push(text);
      setDiagnoseLog([...allLines].join("\n"));
    };

    const totalStart = Date.now();
    allLines.push(`[${new Date().toISOString()}] =================================`);
    allLines.push(`[SYSTEM DIAGNOSTIC START]`);
    allLines.push(`App Version: v${__APP_VERSION__}`);
    allLines.push(`Platform: ${isTauri ? "Tauri Android" : "Web"}`);
    allLines.push(`Device: ${deviceModel}`);
    allLines.push(`=================================================`);
    setDiagnoseLog([...allLines].join("\n"));

    // 1. IndexedDB + 各 Store 记录数统计（开发者定位数据膨胀/IDB 损坏问题需要）
    const dbStart = Date.now();
    startSection("DB", "1. DB");
    log(`IndexedDB connection & CRUD & record counts...`);
    try {
      const db = await getDB();
      log(`OK: Opened "${db.name}" (v${db.version})`);

      const storeNames = Array.from(db.objectStoreNames) as string[];
      log(`ObjectStores (${storeNames.length}): ${storeNames.join(", ")}`);

      // 各 Store 记录数（判断数据膨胀导致卡顿）
      log(`Record counts:`);
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
          log(`  - ${storeName}: ${count} records${warnTag}`);
        } catch (err: any) {
          log(`  - ${storeName}: COUNT ERROR (${err.message})`);
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
      log(`Write latency: ${writeLatency}ms (${writeHealth})`);

      // 清理临时记录
      const deleteTx = db.transaction(["settings"], "readwrite");
      const deleteStore = deleteTx.objectStore("settings");
      await new Promise<void>((resolve, reject) => {
        const req = deleteStore.delete("diagnose_transient_key");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err: any) {
      log(`ERROR: ${err?.stack || err?.message || err}`);
    }
    log(`Elapsed: ${Date.now() - dbStart}ms`);

    // 2. Native Bridge + 关键方法逐个检查（定位"某原生功能失效"问题）
    const bridgeStart = Date.now();
    startSection("BRIDGE", "2. BRIDGE");
    log(`Native Webview bridge verification...`);
    const w = window as WindowWithAndroidBridge;
    if (w.AndroidThemeBridge) {
      log(`OK: AndroidThemeBridge detected.`);
      const methods = Object.getOwnPropertyNames(w.AndroidThemeBridge).filter((p: string) => typeof w.AndroidThemeBridge[p] === 'function');
      log(`Methods (${methods.length}): ${methods.join(", ")}`);

      // 关键方法完整性检查（含新增的 getActiveInputMethod）
      const criticalBridgeMethods = [
        "getSafeAreas", "setStatusBarStyle",
        "saveFile", "saveFileBase64", "openUrl",
        "speakNative", "stopNative", "isSpeakingNative",
        "getActiveInputMethod"
      ];
      const missing = criticalBridgeMethods.filter(m => !methods.includes(m));
      if (missing.length > 0) {
        log(`WARNING: Missing critical methods: ${missing.join(", ")}`);
      } else {
        log(`All critical methods present (OK)`);
      }

      // Safe-area 实际渲染值 vs 桥接返回值对比（定位"CSS env 与原生 inset 不一致"）
      try {
        const bridgeJson = w.AndroidThemeBridge.getSafeAreas?.();
        if (bridgeJson) {
          log(`getSafeAreas() → ${bridgeJson}`);
          const parsed = JSON.parse(bridgeJson);
          // 通过临时探针读取 CSS env(safe-area-inset-*) 的实际渲染值
          const probe = document.createElement("div");
          probe.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;visibility:hidden;";
          probe.style.setProperty("--sa-top", "env(safe-area-inset-top)");
          probe.style.setProperty("--sa-bottom", "env(safe-area-inset-bottom)");
          probe.style.setProperty("--sa-left", "env(safe-area-inset-left)");
          probe.style.setProperty("--sa-right", "env(safe-area-inset-right)");
          // 用 outline-width 借位读取 env 值（content-box 不能直接读 env，这里用 transform 技巧）
          // 更稳妥：直接读 documentElement 的计算样式（前端在 AppContext 里设置过 --safe-area-inset-*）
          document.documentElement.appendChild(probe);
          const cs = getComputedStyle(document.documentElement);
          const cssTop = cs.getPropertyValue("--safe-area-inset-top").trim();
          const cssBottom = cs.getPropertyValue("--safe-area-inset-bottom").trim();
          const cssLeft = cs.getPropertyValue("--safe-area-inset-left").trim();
          const cssRight = cs.getPropertyValue("--safe-area-inset-right").trim();
          probe.remove();
          log(`CSS --safe-area-inset: top=${cssTop || "(unset)"} bottom=${cssBottom || "(unset)"} left=${cssLeft || "(unset)"} right=${cssRight || "(unset)"}`);
          // 比对（桥接返回 dp，CSS 是 px 字符串，仅做存在性差异提示）
          const bridgeKeys = Object.keys(parsed);
          const mismatch = bridgeKeys.filter(k => {
            const cssVal = cs.getPropertyValue(`--safe-area-inset-${k}`).trim();
            return cssVal && cssVal !== "0px" && parsed[k] === 0;
          });
          if (mismatch.length > 0) {
            log(`WARNING: safe-area mismatch on keys: ${mismatch.join(", ")} (bridge=0 but CSS has value)`);
          }
        }
      } catch (err: any) {
        log(`getSafeAreas/cross-check error: ${err?.message || err}`);
      }
    } else {
      log(`WARNING: AndroidThemeBridge undefined (Web environment / not injected).`);
    }
    log(`Elapsed: ${Date.now() - bridgeStart}ms`);

    // 3. TTS/ASR provider 与桥可用性交叉验证（定位"TTS 不出声/ASR 不识别"问题）
    const speechStart = Date.now();
    startSection("SPEECH", "3. SPEECH");
    log(`TTS/ASR provider-availability cross-check...`);
    const hasBridgeTTS = !!(w.AndroidThemeBridge && typeof w.AndroidThemeBridge.speakNative === "function");
    const ttsProvider = settings.ttsConfig?.provider || "speech-synthesis";
    const ttsEnabled = settings.ttsConfig?.enabled;

    if (!ttsEnabled) {
      log(`TTS: disabled (skip)`);
    } else if (ttsProvider === "speech-synthesis") {
      if (hasBridgeTTS) {
        log(`TTS: OK (provider=speech-synthesis, native bridge available)`);
      } else {
        log(`TTS: ERROR (provider=speech-synthesis but native bridge missing! TTS will throw at runtime)`);
      }
    } else if (ttsProvider === "openai") {
      const openaiKey = settings.ttsConfig?.openaiApiKey;
      if (!openaiKey) {
        log(`TTS: WARNING (provider=openai but openaiApiKey empty)`);
      } else {
        log(`TTS: OK (provider=openai, apiKey configured, length=${openaiKey.length})`);
      }
    } else {
      log(`TTS: UNKNOWN provider="${ttsProvider}"`);
    }

    const hasASR = typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
    const asrEnabled = settings.asrConfig?.enabled;
    if (!asrEnabled) {
      log(`ASR: disabled (skip)`);
    } else if (hasASR) {
      log(`ASR: OK (WebSpeech available)`);
    } else {
      log(`ASR: ERROR (enabled but WebSpeech API unavailable in this WebView)`);
    }
    log(`Elapsed: ${Date.now() - speechStart}ms`);

    // 4. Kernel Services - 完整 17 个 + critical 等级（定位"某功能服务未初始化"问题）
    const kernelStart = Date.now();
    startSection("KERNEL", "4. KERNEL");
    log(`Micro-kernel services registry (17 services)...`);
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
          log(`  ${svc.name}: OK${svc.critical ? " (critical)" : ""}`);
          kernelOk++;
        } else {
          log(`  ${svc.name}: NOT FOUND${svc.critical ? " (CRITICAL!)" : " (warning)"}`);
          kernelFailed++;
        }
      } catch (err: any) {
        log(`  ${svc.name}: ERROR - ${err.message}`);
        kernelFailed++;
      }
    }
    log(`Summary: ${kernelOk}/${allServices.length} initialized, ${kernelFailed} failed`);
    log(`Elapsed: ${Date.now() - kernelStart}ms`);

    // 5. 环境信息 - 存储配额 + 网络状态（定位"IDB 写入失败/LLM 慢"问题）
    const envStart = Date.now();
    startSection("ENV", "5. ENV");
    log(`Storage quota & network status...`);

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
        log(`Storage: ${usageMB}MB / ${quotaMB}MB (${percent}% used) ${storageStatus}`);
      } catch (err: any) {
        log(`Storage estimate error: ${err.message}`);
      }
    } else {
      log(`Storage estimate API unavailable`);
    }

    // 网络状态
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    const conn = (navigator as NavigatorWithConnection).connection || (navigator as NavigatorWithConnection).mozConnection || (navigator as NavigatorWithConnection).webkitConnection;
    log(`Online: ${online ? "YES" : "NO (offline)"}`);
    if (conn) {
      log(`Connection: type=${conn.effectiveType || "unknown"}, downlink=${conn.downlink || "unknown"}Mbps, rtt=${conn.rtt || "unknown"}ms`);
    } else {
      log(`Connection API unavailable (desktop / old WebView)`);
    }
    log(`Elapsed: ${Date.now() - envStart}ms`);

    // 6. LLM API Ping（离线时跳过）
    const llmStart = Date.now();
    startSection("LLM_API", "6. LLM API");
    log(`Connection test: ${settings.api?.baseUrl || "https://api.openai.com/v1"}`);
    if (!online) {
      log(`SKIP (device offline)`);
    } else if (!settings.api?.apiKey) {
      log(`WARNING: apiKey is empty. Remote requests will fail.`);
    } else {
      const maskedKey = settings.api.apiKey.length > 8 ? `${settings.api.apiKey.substring(0, 4)}...${settings.api.apiKey.substring(settings.api.apiKey.length - 4)}` : "***";
      log(`apiKey length: ${settings.api.apiKey.length} (${maskedKey}). Type: ${settings.api.type || "openai-compat"}`);
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
          log(`OK: HTTP ${status}. Latency: ${latency}ms`);
          log(`Message: ${data.message || "Connected"}`);
        } else {
          log(`ERROR: HTTP ${status}.`);
          if (data) {
            log(`Details: ${data.error || JSON.stringify(data)}`);
          } else {
            const cleanText = rawText.trim();
            const snippet = cleanText.length > 300 ? cleanText.substring(0, 300) + "... [truncated]" : cleanText;
            log(`Raw payload: ${snippet || "(empty response)"}`);

            // 诊断提示
            if (status === 502) {
              log(`DIAGNOSIS: 502 Bad Gateway. Proxy cannot reach upstream LLM API.`);
            } else if (status === 504) {
              log(`DIAGNOSIS: 504 Gateway Timeout. Proxy timed out waiting for upstream.`);
            } else if (status === 403) {
              log(`DIAGNOSIS: 403 Forbidden. Rejected by Cloudflare/firewall/CORS/credentials.`);
            } else if (status === 404) {
              log(`DIAGNOSIS: 404 Not Found. Verify baseUrl and endpoint paths.`);
            }
          }
        }
      } catch (err: any) {
        log(`ERROR: Ping failed.`);
        log(`Details: ${err?.stack || err?.message || err}`);
      }
    }
    log(`Elapsed: ${Date.now() - llmStart}ms`);

    // 7. 视口/键盘诊断（定位"小键盘遮挡输入框"等瞬态问题，含黑匣子事件历史）
    const viewportStart = Date.now();
    startSection("VIEWPORT", "7. VIEWPORT");
    log(`Viewport & keyboard diagnostic (black-box history)...`);
    log(`meta: ${getViewportMeta()}`);
    const snap = getViewportSnapshot();
    log(`window: ${snap.innerW}x${snap.innerH}`);
    log(`visualViewport: ${snap.hasVisualViewport ? `${snap.vvpW}x${snap.vvpH} (offsetTop=${snap.vvpOffsetTop}, scale=${snap.vvpScale})` : "UNAVAILABLE (no visualViewport API)"}`);
    const dvh = measureDynamicViewportHeight();
    const dvhMismatch = dvh !== null && dvh !== snap.innerH;
    log(`100dvh measured: ${dvh ?? "N/A"}px (vs innerH=${snap.innerH}px${dvhMismatch ? " ⚠️ MISMATCH" : " match"})`);

    // 键盘状态与高度估算
    const kbState = estimateKeyboardState(snap);
    log(`Keyboard: ${kbState.likelyUp ? "UP ⚠️" : "DOWN"}` + (kbState.estimatedHeightPx !== null ? ` (estimated height: ${kbState.estimatedHeightPx}px)` : ""));
    log(`Keyboard basis: ${kbState.basis}`);

    // active element 遮挡判定（键盘遮挡输入框的核心信号）
    const occ = checkActiveElementOcclusion(snap);
    if (occ.hasActiveElement && occ.tagName) {
      log(`Active element: <${occ.tagName}>` + (occ.rect ? ` rect={top:${occ.rect.top}, bottom:${occ.rect.bottom}, left:${occ.rect.left}, right:${occ.rect.right}, w:${occ.rect.width}, h:${occ.rect.height}}` : ""));
      log(`Visible bottom: ${occ.visibleBottomPx ?? "N/A"}px`);
      if (occ.isOccluded) {
        log(`ERROR: ${occ.detail}`);
      } else {
        log(`Occlusion check: ${occ.detail}`);
      }
    } else {
      log(`Active element: none (no input/textarea focused)`);
    }

    const history = getViewportHistory();
    log(`Resize event history (${history.length} records, oldest→newest):`);
    for (const r of history) {
      const tm = new Date(r.time).toISOString().split("T")[1].replace("Z", "");
      const vvpStr = r.vvpH !== null ? `${r.vvpW}x${r.vvpH} off=${r.vvpOffsetTop} scale=${r.vvpScale}` : "no-vvp";
      log(`  ${tm} [${r.source}] win=${r.innerW}x${r.innerH} vvp=${vvpStr}`);
    }
    // 自动诊断提示：判定 keyboard avoidance 事件通道健康度
    const hasVvpResize = history.some(r => r.source === "visualViewport");
    const hasWinResize = history.some(r => r.source === "window");
    if (history.length > 1 && hasWinResize && !hasVvpResize) {
      log(`DIAGNOSIS: window.resize fired but visualViewport.resize NEVER fired.`);
      log(`  → interactive-widget=resizes-content 下 vvp.resize 缺失，容器高度需同时监听 window.resize。`);
    } else if (history.length > 1 && hasVvpResize && !hasWinResize) {
      log(`DIAGNOSIS: visualViewport.resize fired but window.resize NEVER fired.`);
      log(`  → overlays-content 模式典型特征，offsetTop 应在键盘弹出时增大。`);
    }
    log(`Elapsed: ${Date.now() - viewportStart}ms`);

    // 8. 输入法诊断（定位"特定输入法导致键盘遮挡/中文合成异常"问题）
    const imeStart = Date.now();
    startSection("INPUT_METHOD", "8. INPUT_METHOD");
    log(`Active input method (IME) diagnostic...`);
    if (w.AndroidThemeBridge?.getActiveInputMethod) {
      try {
        const imeJson = w.AndroidThemeBridge.getActiveInputMethod();
        log(`Bridge result: ${imeJson}`);
        try {
          const ime = JSON.parse(imeJson);
          if (ime.error) {
            log(`ERROR: ${ime.error}`);
          } else {
            log(`Label: ${ime.label || "(unknown)"}`);
            log(`Package: ${ime.package || "(unknown)"}`);
            log(`ID: ${ime.id || "(unknown)"}`);
            log(`Is system IME: ${ime.is_system ? "YES" : "NO (third-party)"}`);
            log(`Enabled IME count: ${ime.enabled_count ?? "N/A"}`);
            if (!ime.is_system && ime.package) {
              log(`NOTE: third-party IME may override keyboard avoidance behavior.`);
            }
          }
        } catch (e: any) {
          log(`JSON parse error: ${e?.message || e}`);
        }
      } catch (err: any) {
        log(`ERROR: getActiveInputMethod() threw: ${err?.message || err}`);
      }
    } else {
      log(`WARNING: getActiveInputMethod not available (bridge not injected or old version).`);
      // Web 回落：检测 composition 事件能力（无法区分具体输入法）
      log(`Web fallback: composition events will fire on IME input (cannot identify specific IME in WebView).`);
    }
    log(`Elapsed: ${Date.now() - imeStart}ms`);

    // 9. WebView 内核与版本（定位"旧 WebView 不支持 visualViewport/新 CSS"问题）
    const webviewStart = Date.now();
    startSection("WEBVIEW", "9. WEBVIEW");
    log(`WebView engine & version detection...`);
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    log(`User-Agent: ${ua}`);
    // 提取 Chrome 主版本号
    const chromeMatch = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (chromeMatch) {
      const major = parseInt(chromeMatch[1], 10);
      log(`Chrome major version: ${major}`);
      if (major < 87) {
        log(`WARNING: Chrome < 87, visualViewport.resize 与部分 CSS 单位 (dvh/svh) 支持可能不完整。`);
      } else if (major < 100) {
        log(`NOTE: Chrome ${major}, visualViewport 支持完整但部分新 API 可能缺失。`);
      } else {
        log(`Chrome version OK (>=100).`);
      }
    } else {
      log(`NOTE: Chrome version not found in UA (non-Chromium WebView?).`);
    }
    // 判定是否 X5/Tencent 内核（腾讯系 WebView，常见于国产应用内嵌）
    if (/TBS|MQQBrowser|X5/.test(ua)) {
      log(`WARNING: Tencent X5/TBS WebView detected (known keyboard avoidance quirks).`);
    }
    // 判定是否 Android System WebView
    if (/Android\s([\d.]+)/.test(ua)) {
      const androidVer = ua.match(/Android\s([\d.]+)/)?.[1];
      log(`Android OS version (from UA): ${androidVer}`);
    }
    // WebGL renderer（显卡/芯片信息，部分 WebView 暴露）
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          log(`WebGL renderer: ${renderer || "(unavailable)"}`);
        }
      }
    } catch (e: any) {
      log(`WebGL renderer probe failed: ${e?.message || e}`);
    }
    log(`Elapsed: ${Date.now() - webviewStart}ms`);

    // 10. 屏幕物理信息（定位"分辨率/DPI/方向导致 UI 错位"问题）
    const displayStart = Date.now();
    startSection("DISPLAY", "10. DISPLAY");
    log(`Screen physical info...`);
    if (typeof screen !== "undefined") {
      log(`screen.width x height: ${screen.width} x ${screen.height}`);
      log(`screen.availWidth x availHeight: ${screen.availWidth} x ${screen.availHeight}`);
      log(`screen.colorDepth: ${screen.colorDepth} bit`);
      log(`screen.pixelDepth: ${screen.pixelDepth} bit`);
    } else {
      log(`screen API unavailable`);
    }
    log(`window.devicePixelRatio: ${window.devicePixelRatio ?? "N/A"}`);
    // 屏幕方向
    if (typeof screen !== "undefined" && screen.orientation) {
      log(`screen.orientation: type=${screen.orientation.type}, angle=${screen.orientation.angle}`);
    } else if (typeof window !== "undefined") {
      // window.orientation 已废弃，TS 标准类型未声明，用受控断言读取
      const orientation = (window as { orientation?: number }).orientation;
      if (typeof orientation !== "undefined") {
        log(`window.orientation: ${orientation}`);
      } else {
        log(`Orientation API unavailable`);
      }
    } else {
      log(`Orientation API unavailable`);
    }
    // 匹配 prefers-color-scheme
    if (typeof matchMedia === "function") {
      try {
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        log(`prefers-color-scheme: ${dark ? "dark" : "light"}`);
      } catch (_) {
        log(`prefers-color-scheme: probe failed`);
      }
    }
    log(`Elapsed: ${Date.now() - displayStart}ms`);

    // 11. 系统字体缩放（定位"用户调大系统字体导致 UI 撑爆"问题）
    const fontStart = Date.now();
    startSection("SYSTEM_FONT", "11. SYSTEM_FONT");
    log(`System font scale & root font-size...`);
    try {
      const html = document.documentElement;
      const htmlCs = getComputedStyle(html);
      const htmlFontSize = htmlCs.fontSize;
      log(`documentElement computed font-size: ${htmlFontSize}`);
      // body 字号
      const bodyCs = getComputedStyle(document.body);
      log(`body computed font-size: ${bodyCs.fontSize}`);
      // 检测根字号是否被用户放大（通常应 ≤ 16px，16px = 1rem 基准）
      const htmlPx = parseFloat(htmlFontSize);
      if (!isNaN(htmlPx)) {
        if (htmlPx > 20) {
          log(`WARNING: root font-size ${htmlPx}px > 20px (user may have enlarged system font, layout may overflow).`);
        } else if (htmlPx < 12) {
          log(`NOTE: root font-size ${htmlPx}px < 12px (non-standard baseline).`);
        } else {
          log(`root font-size OK (${htmlPx}px, within 12-20px).`);
        }
      }
      // -webkit-text-size-adjust（部分 WebView 受系统字体缩放影响）
      const tsa = htmlCs.getPropertyValue("-webkit-text-size-adjust");
      if (tsa) log(`-webkit-text-size-adjust: ${tsa}`);
    } catch (err: any) {
      log(`ERROR: font-size probe failed: ${err?.message || err}`);
    }
    log(`Elapsed: ${Date.now() - fontStart}ms`);

    // 12. 内存压力（定位"长会话/大角色卡导致 OOM 或卡顿"问题）
    const memStart = Date.now();
    startSection("MEMORY", "12. MEMORY");
    log(`Memory pressure diagnostic...`);
    const perf = performance as PerformanceWithMemory;
    if (perf.memory) {
      const used = (perf.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
      const total = (perf.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
      const limit = (perf.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
      const pct = parseFloat(limit) > 0 ? ((parseFloat(used) / parseFloat(limit)) * 100).toFixed(1) : "N/A";
      const pctNum = parseFloat(pct);
      const memStatus = pctNum > 80 ? "⚠️ CRITICAL (OOM risk)" : pctNum > 60 ? "⚠️ WARNING" : "OK";
      log(`JS heap: used=${used}MB / total=${total}MB / limit=${limit}MB (${pct}% used) ${memStatus}`);
    } else {
      log(`performance.memory unavailable (non-Chromium WebView).`);
    }
    // navigator.deviceMemory（设备物理内存，GB，粗糙值）
    const navMem = navigator as NavigatorWithMemory;
    if (typeof navMem.deviceMemory === "number") {
      log(`navigator.deviceMemory: ${navMem.deviceMemory} GB`);
      if (navMem.deviceMemory <= 2) {
        log(`WARNING: low-RAM device (≤2GB), expect aggressive eviction on heavy sessions.`);
      }
    } else {
      log(`navigator.deviceMemory unavailable.`);
    }
    log(`Elapsed: ${Date.now() - memStart}ms`);

    // 13. TTS 引擎列表（定位"无中文语音/引擎缺失"问题）
    const voicesStart = Date.now();
    startSection("TTS_VOICES", "13. TTS_VOICES");
    log(`Web Speech API voices (for WebSpeech provider only)...`);
    if (typeof speechSynthesis !== "undefined") {
      try {
        const voices = speechSynthesis.getVoices();
        log(`Voices count: ${voices.length}`);
        if (voices.length > 0) {
          // 列出前 5 个，重点标注中文语音
          const preview = voices.slice(0, 5).map(v => `${v.name}(${v.lang})`).join(", ");
          log(`First 5 voices: ${preview}`);
          const zhVoices = voices.filter(v => /^zh/i.test(v.lang));
          log(`Chinese (zh*) voices: ${zhVoices.length}` + (zhVoices.length > 0 ? ` → ${zhVoices.slice(0, 3).map(v => v.name).join(", ")}` : " ⚠️ NONE"));
          if (zhVoices.length === 0 && voices.length > 0) {
            log(`WARNING: no Chinese voice available, WebSpeech TTS will fall back to default voice.`);
          }
        } else {
          log(`NOTE: voices empty (may populate after voiceschanged event, retry later).`);
        }
      } catch (err: any) {
        log(`ERROR: getVoices() threw: ${err?.message || err}`);
      }
    } else {
      log(`speechSynthesis API unavailable (rely on native bridge TTS).`);
    }
    log(`Elapsed: ${Date.now() - voicesStart}ms`);

    flushSection();

    const totalElapsed = Date.now() - totalStart;
    allLines.push(`\n=================================================`);
    allLines.push(`[DIAGNOSTIC COMPLETE] Total elapsed: ${totalElapsed}ms`);
    allLines.push(`=================================================`);
    setDiagnoseLog(allLines.join("\n"));
    setSections(sectionList);
    setIsChecking(false);
  };

  // 复制单个诊断项
  const copySection = (sec: DiagnosticSection) => {
    const text = `[${sec.title}]\n${sec.lines.filter(l => !l.startsWith(`\n[`)).join("\n")}`;
    writeClipboard(text);
    showCustomAlert(t("report.copied_section"), t("report.copy_success"));
  };

  // 只复制出错项（含 ERROR/WARNING/CRITICAL 的 section）
  const copyErrorsOnly = () => {
    const errorSections = sections.filter(s => s.hasError || s.hasWarning);
    if (errorSections.length === 0) {
      showCustomAlert(t("report.no_errors"), t("report.copy_success"));
      return;
    }
    const text = errorSections.map(sec =>
      `[${sec.title}]\n${sec.lines.filter(l => !l.startsWith(`\n[`)).join("\n")}`
    ).join("\n\n");
    writeClipboard(text);
    showCustomAlert(t("report.copied_errors", { count: String(errorSections.length) }), t("report.copy_success"));
  };

  // 复制完整报告（基础信息 + 完整日志）
  const copyFullReport = () => {
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
    writeClipboard(copyText);
    showCustomAlert(diagnoseLog ? t("report.copied_all") : t("report.copied_basic"), t("report.copy_success"));
  };

  // 错误摘要计数
  const errorCount = sections.filter(s => s.hasError).length;
  const warningCount = sections.filter(s => s.hasWarning).length;

  return (
    <div className="mt-6 text-center space-y-1 pb-4 select-text font-mono text-[9px] text-muted-foreground/80">
      <p className="font-bold text-[10px] text-muted-foreground mb-1 select-none flex items-center justify-center gap-1">
        🛠️ {t("report.title")}
        <button
          onClick={copyFullReport}
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
        {sections.length > 0 && (errorCount > 0 || warningCount > 0) && (
          <button
            onClick={copyErrorsOnly}
            className="text-[9px] text-amber-500 hover:underline font-normal cursor-pointer select-none px-1.5 py-0.5 border border-amber-500/20 rounded bg-amber-500/5 hover:bg-amber-500/10 ml-1 active:scale-95 transition-all"
          >
            {t("report.copy_errors")}
          </button>
        )}
      </p>

      {/* 错误摘要 */}
      {sections.length > 0 && (
        <p className={`opacity-80 font-bold ${errorCount > 0 ? "text-red-400" : warningCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
          {t("report.errors_summary", { errors: String(errorCount), warnings: String(warningCount) })}
        </p>
      )}

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

      {/* 分块诊断结果：每项独立显示 + 独立复制按钮 */}
      {sections.length > 0 && (
        <div className="mt-3 space-y-2 text-left">
          {sections.map(sec => (
            <div
              key={sec.id}
              className={`p-2 bg-zinc-950/90 border rounded-lg text-zinc-300 font-sans tracking-wide overflow-x-auto max-w-full shadow-inner leading-relaxed ${
                sec.hasError ? "border-red-500/40" : sec.hasWarning ? "border-amber-500/40" : "border-zinc-800"
              }`}
            >
              <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1 text-[8px] font-bold select-none">
                <span className={sec.hasError ? "text-red-400" : sec.hasWarning ? "text-amber-400" : "text-zinc-500"}>
                  {sec.hasError ? "⛔ " : sec.hasWarning ? "⚠️ " : "✓ "}{sec.title}
                </span>
                <button
                  onClick={() => copySection(sec)}
                  className="text-primary hover:underline text-[8px]"
                >
                  [{t("report.copy_section")}]
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all select-text font-mono text-[8.5px] leading-relaxed text-zinc-300">
                {sec.lines.filter(l => !l.startsWith("\n[")).join("\n")}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* 完整日志（折叠态，保留原行为供需要全量的场景使用） */}
      {diagnoseLog && sections.length === 0 && (
        <div className="mt-3 text-left p-2.5 bg-zinc-950/90 border border-zinc-800 rounded-lg text-zinc-300 font-sans tracking-wide overflow-x-auto max-w-full shadow-inner leading-relaxed">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-1.5 text-[8px] font-bold text-zinc-500 select-none">
            <span>🛠️ {t("report.title")} DEBUGLOG</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  writeClipboard(diagnoseLog);
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
