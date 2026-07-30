import { useState } from "react";
import type { IDatabaseService } from "../../../../application/serviceContracts";
import type { CharacterCard, ChatSession, Message, SummaryCard } from "../../../../types";
import { useTranslation } from "../../../../contexts/LanguageContext";
import { Logger } from "../../../../utils/logger";
import { SystemReportPanel } from "./SystemReportPanel";
import { isErrorLine, isWarningLine, writeClipboard } from "./reportUtils";
import type {
  DiagnosticSection,
  NavigatorWithConnection,
  NavigatorWithMemory,
  PerformanceWithMemory,
  SystemReportSectionProps,
  WindowWithAndroidBridge,
} from "./types";
import {
  getViewportSnapshot,
  getViewportHistory,
  getViewportMeta,
  measureDynamicViewportHeight,
  estimateKeyboardState,
  checkActiveElementOcclusion,
} from "../../../../utils/viewportDiagnostic";

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

    const logger = Logger.create("SystemReport");

    const startSection = (id: string, title: string) => {
      flushSection();
      currentSecId = id;
      currentSecTitle = title;
      currentSecLines = [];
      const header = `\n[${title}]`;
      allLines.push(header);
      currentSecLines.push(header);
      setDiagnoseLog([...allLines].join("\n"));

      logger.info(`=== Section: ${title} ===`);
    };

    const log = (text: string, err?: unknown) => {
      let uiText = text;
      if (err != null) {
        const errMsg = err instanceof Error ? err.message : String(err);
        uiText = `${text} (Details: ${errMsg})`;
      }
      allLines.push(uiText);
      currentSecLines.push(uiText);
      setDiagnoseLog([...allLines].join("\n"));

      const cleanText = text.trim();
      if (isErrorLine(cleanText) || err != null) {
        logger.error(cleanText, err, { skipTelemetry: true });
      } else if (isWarningLine(cleanText)) {
        logger.warn(cleanText);
      } else {
        logger.info(cleanText);
      }
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
      const databaseService = getKernelService<
        IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message>
      >("database");
      const snapshot = await databaseService.runStorageDiagnostics();
      log(`OK: Opened "${snapshot.databaseName}" (v${snapshot.version})`);
      log(`ObjectStores (${snapshot.storeNames.length}): ${snapshot.storeNames.join(", ")}`);
      log(`Record counts:`);
      for (const storeName of snapshot.storeNames) {
        const count = snapshot.recordCounts[storeName] ?? 0;
        const warnTag = count > 1000 ? " ⚠️ HIGH" : count > 200 ? " (moderate)" : "";
        log(`  - ${storeName}: ${count} records${warnTag}`);
      }
      const writeHealth = snapshot.writeLatencyMs < 50
        ? "EXCELLENT"
        : snapshot.writeLatencyMs < 200
          ? "GOOD"
          : "SLOW";
      log(`Write latency: ${snapshot.writeLatencyMs}ms (${writeHealth})`);
      log(snapshot.readWriteVerified
        ? `Read & Verify: OK (integrity verified, readwrite loopcheck passed)`
        : `ERROR: IndexedDB read integrity failed (value mismatch or transient key lost)`);
    } catch (err: unknown) {
      log(`ERROR: Database connection or CRUD check failed`, err);
    }
    log(`Elapsed: ${Date.now() - dbStart}ms`);

    // 2. Native Bridge + 关键方法逐个检查（定位"某原生功能失效"问题）
    const bridgeStart = Date.now();
    startSection("BRIDGE", "2. BRIDGE");
    log(`Native Webview bridge verification...`);
    const w = window as WindowWithAndroidBridge;
    const bridge = w.AndroidThemeBridge;
    if (bridge) {
      log(`OK: AndroidThemeBridge detected.`);
      const methods = Object.getOwnPropertyNames(bridge).filter((p: string) => typeof bridge[p] === 'function');
      log(`Methods (${methods.length}): ${methods.join(", ")}`);

      // 关键方法完整性检查（含新增的 getActiveInputMethod）
      const criticalBridgeMethods = [
        "getSafeAreas", "setStatusBarStyle",
        "saveFile", "saveFileBase64", "verifyFileIo", "openUrl",
        "speakNative", "stopNative", "isSpeakingNative",
        "getActiveInputMethod"
      ];
      const missing = criticalBridgeMethods.filter(m => !methods.includes(m));
      if (missing.length > 0) {
        log(`WARNING: Missing critical methods: ${missing.join(", ")}`);
      } else {
        log(`All critical methods present (OK)`);
      }

      // 存储权限检测
      if (typeof bridge.hasStoragePermission === "function") {
        try {
          const permitted = bridge.hasStoragePermission();
          log(`Storage permission (native check): ${permitted ? "GRANTED" : "⚠️ DENIED (users must grant storage permission manually)"}`);
        } catch (err: unknown) {
          log(`Storage permission check error`, err);
        }
      }

      // Safe-area 实际渲染值 vs 桥接返回值对比（定位"CSS env 与原生 inset 不一致"）
      try {
        const bridgeJson = bridge.getSafeAreas?.();
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
          document.documentElement.appendChild(probe);
          
          // 从 probe 获取计算样式
          const cs = getComputedStyle(probe);
          const cssTop = cs.getPropertyValue("--sa-top").trim();
          const cssBottom = cs.getPropertyValue("--sa-bottom").trim();
          const cssLeft = cs.getPropertyValue("--sa-left").trim();
          const cssRight = cs.getPropertyValue("--sa-right").trim();
          probe.remove();
          
          log(`CSS --safe-area-inset: top=${cssTop || "(unset)"} bottom=${cssBottom || "(unset)"} left=${cssLeft || "(unset)"} right=${cssRight || "(unset)"}`);
          // 比对（桥接返回 dp，CSS 是 px 字符串，仅做存在性差异提示）
          const bridgeKeys = Object.keys(parsed);
          const mismatch = bridgeKeys.filter(k => {
            const cssVal = cs.getPropertyValue(`--sa-${k}`).trim();
            return cssVal && cssVal !== "0px" && parsed[k] === 0;
          });
          if (mismatch.length > 0) {
            log(`WARNING: safe-area mismatch on keys: ${mismatch.join(", ")} (bridge=0 but CSS has value)`);
          }
        }
      } catch (err: unknown) {
        log(`getSafeAreas/cross-check error`, err);
      }

      // 原生桥接 IPC 往返延迟压力测试
      if (typeof bridge.isSpeakingNative === "function") {
        try {
          const ipcStart = Date.now();
          const count = 15;
          for (let i = 0; i < count; i++) {
            bridge.isSpeakingNative();
          }
          const ipcElapsed = Date.now() - ipcStart;
          const avgLatency = ipcElapsed / count;
          const latencyStatus = avgLatency < 2 ? "EXCELLENT" : avgLatency < 7 ? "GOOD" : "⚠️ SLOW (IPC pathway congestion risk)";
          log(`Native bridge IPC latency: ${avgLatency.toFixed(2)}ms/call (${latencyStatus})`);
        } catch (err: unknown) {
          log(`Native bridge IPC latency test error`, err);
        }
      }

      // 原生文件存取 IO 闭环验证。由原生层持有 MediaStore URI 并负责清理临时文件，
      // 避免将 saveFile 返回的展示路径误传给只接受受控绝对路径的 readLocalFile。
      if (typeof bridge.verifyFileIo === "function") {
        try {
          const result = bridge.verifyFileIo();
          if (result.startsWith("error:")) {
            log(`File IO ERROR: native loopcheck failed (${result})`);
          } else {
            log(`File IO (Write, Read, Verify & Cleanup): OK`);
          }
        } catch (err: unknown) {
          log(`File IO Loopcheck error`, err);
        }
      } else {
        log(`File IO WARNING: verifyFileIo unavailable (native bridge update required).`);
      }
    } else {
      log(`WARNING: AndroidThemeBridge undefined (Web environment / not injected).`);
    }
    log(`Elapsed: ${Date.now() - bridgeStart}ms`);

    // 3. TTS/ASR provider 与桥可用性交叉验证（定位"TTS 不出声/ASR 不识别"问题）
    const speechStart = Date.now();
    startSection("SPEECH", "3. SPEECH");
    log(`TTS/ASR provider-availability cross-check...`);
    const hasBridgeTTS = !!(bridge && typeof bridge.speakNative === "function");
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
    } else {
      // 麦克风硬件设备探测
      if (typeof navigator !== "undefined" && navigator.mediaDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const hasMic = devices.some(d => d.kind === "audioinput");
          log(`Audio Input Hardware: ${hasMic ? "Detected microphone hardware (OK)" : "⚠️ No microphone hardware found"}`);
        } catch (err: unknown) {
          log(`Audio Hardware probe warning`, err);
        }
      } else {
        log(`Audio Hardware API: UNAVAILABLE (non-secure context or old WebView)`);
      }

      // 麦克风录音权限检测
      if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
          log(`Microphone permission status: ${status.state.toUpperCase()}`);
        } catch (_) {
          // 部分环境不支持 query 麦克风权限，静默跳过
        }
      }

      if (hasASR) {
        log(`ASR: OK (WebSpeech available)`);
      } else {
        log(`ASR: ERROR (enabled but WebSpeech API unavailable in this WebView)`);
      }
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
      } catch (err: unknown) {
        log(`  ${svc.name}: ERROR`, err);
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
      } catch (err: unknown) {
        log(`Storage estimate error`, err);
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
        const { universalFetch } = await import("../../../../utils/apiClient");
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

        let data: Record<string, unknown> | null = null;
        let rawText = "";
        try {
          rawText = await response.text();
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json") || (rawText.trim().startsWith("{") && rawText.trim().endsWith("}"))) {
            const parsed: unknown = JSON.parse(rawText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              data = parsed as Record<string, unknown>;
            }
          }
        } catch (e: unknown) {
          // Fallback if reading text fails
        }

        if (response.ok && data?.success === true) {
          log(`OK: HTTP ${status}. Latency: ${latency}ms`);
          log(`Message: ${typeof data.message === "string" ? data.message : "Connected"}`);
        } else {
          log(`ERROR: HTTP ${status}.`);
          if (data) {
            log(`Details: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`);
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
      } catch (err: unknown) {
        log(`ERROR: Ping failed`, err);
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
    const dvhMismatch = dvh !== null && Math.abs(dvh - snap.innerH) > 1.5;
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
    if (bridge?.getActiveInputMethod) {
      try {
        const imeJson = bridge.getActiveInputMethod();
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
        } catch (e: unknown) {
          log(`JSON parse error`, e);
        }
      } catch (err: unknown) {
        log(`ERROR: getActiveInputMethod() threw`, err);
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
    } catch (e: unknown) {
      log(`WebGL renderer probe failed`, e);
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
    } catch (err: unknown) {
      log(`ERROR: font-size probe failed`, err);
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
      } catch (err: unknown) {
        log(`ERROR: getVoices() threw`, err);
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

  const copyDiagnoseLog = () => {
    writeClipboard(diagnoseLog);
    showCustomAlert(t("report.copied_log"), t("report.copy_success"));
  };

  return (
    <SystemReportPanel
      sections={sections}
      diagnoseLog={diagnoseLog}
      isChecking={isChecking}
      isTauri={isTauri}
      deviceModel={deviceModel}
      viewportSize={viewportSize}
      safeAreas={safeAreas}
      onRunSelfCheck={runSelfCheck}
      onCopyFullReport={copyFullReport}
      onCopyErrorsOnly={copyErrorsOnly}
      onCopySection={copySection}
      onCopyDiagnoseLog={copyDiagnoseLog}
      onClearDiagnoseLog={() => setDiagnoseLog("")}
    />
  );
}
