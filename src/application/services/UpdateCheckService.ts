import { IKernel, IKernelService, IUpdateCheckService, UpdateInfo } from "../serviceContracts";
import { compareVersions } from "compare-versions";
import { publicEnvironment } from "../../config";
import { Logger } from "../../utils/logger";
import { CLOUD_ENDPOINTS } from "../../utils/cloudEndpoints";

const logger = Logger.create("UpdateCheckService");

// 架构（2026-10-10 起）：原生客户端直接 GET 本仓库自有服务器的 /version.json，
// 服务端从 downloads 目录实时推导"最新版本 + 发布日期 + 固定下载链接"，不再经过
// 阿里云函数计算；是否为新版本由客户端按 compareVersions 自行判定（服务端无状态）。
// 浏览器开发环境仍走 server.ts 的 /api/check-update 模拟端点。

// Network Information API 类型扩展（部分浏览器使用厂商前缀）
interface NetworkConnectionLike {
  type?: string;
  effectiveType?: string;
}

interface NavigatorNetworkInformation extends Navigator {
  connection?: NetworkConnectionLike;
  mozConnection?: NetworkConnectionLike;
  webkitConnection?: NetworkConnectionLike;
}

// Tauri 原生运行时注入的全局对象
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
}

export class UpdateCheckService implements IUpdateCheckService {
  name = "updateCheck";
  isCritical = false;
  
  dependencies = [] as const;

  private abortController: AbortController | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    logger.info("Initializing");
    this.abortController = new AbortController();
    if (signal) {
      // 对齐 LLMService.ts 实现：处理 signal 已 aborted 的初始状态，避免无效请求
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    logger.info("Destroyed");
  }

  async checkUpdate(currentVersion: string, signal?: AbortSignal, force?: boolean): Promise<UpdateInfo> {
    const activeSignal = signal || this.abortController?.signal;

    // 1. 本地网络环境校验：必须是 wifi 环境下才触发（避免非 wifi 自动下载浪费蜂窝流量）
    let network = "unknown";
    if (typeof navigator !== "undefined") {
      const conn = (navigator as NavigatorNetworkInformation).connection || (navigator as NavigatorNetworkInformation).mozConnection || (navigator as NavigatorNetworkInformation).webkitConnection;
      if (conn) {
        network = conn.type || (conn.effectiveType ? conn.effectiveType : "unknown");
      } else if (navigator.onLine) {
        network = "wifi"; // 兜底为 wifi 状态
      }
    }
    const isWifi = network.toLowerCase() === "wifi" || network.toLowerCase() === "ethernet";

    // 2. 本地系统版本校验：必须是 Android 11+ 环境
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "Node/Unknown";
    const isAndroid = /android/i.test(userAgent);
    
    let androidVersion = 0;
    const uaMatch = userAgent.match(/Android\s+([0-9]+)/i);
    if (uaMatch && uaMatch[1]) {
      androidVersion = parseInt(uaMatch[1], 10);
    }
    const isAndroid11Plus = isAndroid && androidVersion >= 11;

    // 是否是本地开发/测试模式：如果是 localhost 或处于单元测试，跳过环境限制方便调试
    const isTest = publicEnvironment.isTest
      || (
        typeof process !== "undefined"
        && process.argv
        && process.argv.some((argument) => argument.includes("run_all_tests"))
      );

    const isDev = typeof window !== "undefined" && window.location && (
      window.location.hostname === "localhost" || 
      window.location.hostname === "127.0.0.1"
    );

    const isDevOrTest = isDev || isTest;

    // 如果未满足环境条件（不是 Wifi 或不是 Android 11+），且非本地开发/测试环境，且非手动强制更新，则不触发更新检测
    if (!force && !isDevOrTest && (!isWifi || !isAndroid11Plus)) {
      logger.info("Pre-check failed, skip update check", { isWifi, isAndroid11Plus });
      return {
        hasUpdate: false,
        message: "当前版本已是最新，无需更新"
      };
    }

    // 3. 准备唯一设备凭据 userCredential
    let userCredential = "local_unknown_device";
    if (typeof localStorage !== "undefined") {
      const storedId = localStorage.getItem("TELEMETRY_DEVICE_ID");
      if (storedId) {
        userCredential = storedId;
      } else {
        // 自动生成兜底的随机设备 ID
        userCredential = "dev_" + Math.random().toString(36).substring(2, 10);
        localStorage.setItem("TELEMETRY_DEVICE_ID", userCredential);
      }
    }

    // 4. 生成请求时间戳（服务端用于防重放校验，5 分钟有效期）
    const timestamp = Date.now();

    // 5. 判定是否为客户端 Native 环境 (tauri 运行环境)
    const isClient = typeof window !== "undefined" && (
      window.location.protocol.startsWith("tauri") ||
      window.location.protocol === "file:" ||
      window.location.hostname === "tauri.localhost" ||
      !!(window as TauriWindow).__TAURI_INTERNALS__ ||
      !!(window as TauriWindow).__TAURI_IPC__
    );

    // 选择目标接口：原生环境直连 FC，浏览器开发环境连本地 server.ts
    // 注意：oss-get-moblie 是更新检查专用 FC 函数；catbot-gmkodirnhh 是 LLM 代理函数，二者不同
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "http://127.0.0.1:3000";
    const url = isClient
      ? CLOUD_ENDPOINTS.updateCheck
      : `${origin}/api/check-update`;

    // 根据是否是 Tauri 环境，决定是否引入 tauri-plugin-http fetch 避开 CORS
    let fetchFn = fetch;
    if (isClient) {
      try {
        const mod = await import("@tauri-apps/plugin-http");
        if (mod && typeof mod.fetch === "function") {
          fetchFn = mod.fetch;
        }
      } catch (err) {
        logger.warn("Failed to load Tauri native HTTP plugin, fallback to window.fetch");
      }
    }

    try {
      logger.info("Requesting update check", { url });
      // 原生客户端：GET 自有服务器的 version.json（无状态、无需签名/时间戳）；
      // 浏览器开发环境：沿用 server.ts 的 POST 模拟端点（保留原请求体形状）。
      const response = isClient
        ? await fetchFn(url, { method: "GET", signal: activeSignal })
        : await fetchFn(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              clientVersion: currentVersion,
              userCredential,
              timestamp,
            }),
            signal: activeSignal,
          });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const resJson = await response.json();
      
      // 兼容两种返回：本站 version.json（平铺）与浏览器开发环境的 { success, data } 模拟结构
      if (resJson.success && resJson.data) {
        return {
          hasUpdate: true,
          // 优先使用服务端返回的 latestVersion，避免客户端硬编码导致版本不同步
          latestVersion: resJson.data.latestVersion || resJson.latestVersion || "",
          downloadUrl: resJson.data.downloadUrl || "",
          releaseDate: resJson.data.releaseDate || resJson.releaseDate,
          message: resJson.message,
          enablePush: resJson.data.enablePush !== false
        };
      }
      
      // 本站 version.json：最新版本 + 发布日期 + 固定下载链接；是否为新版本客户端自行判定
      const latestVersion = String(resJson.latestVersion || "").replace(/^v/, "");
      const hasUpdate = latestVersion
        ? compareVersions(latestVersion, String(currentVersion).replace(/^v/, "")) > 0
        : resJson.hasUpdate === true;
      return {
        hasUpdate,
        latestVersion: latestVersion || resJson.latestVersion || currentVersion,
        downloadUrl: resJson.downloadUrl || resJson.versionedUrl || "",
        releaseDate: typeof resJson.releaseDate === "string" ? resJson.releaseDate : undefined,
        message: resJson.message,
        enablePush: resJson.enablePush !== false
      };

    } catch (e: unknown) {
      logger.error("Failed to execute update check", e);
      return {
        hasUpdate: false,
      };
    }
  }
}
