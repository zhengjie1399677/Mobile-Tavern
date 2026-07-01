import { IKernel, IKernelService, IUpdateCheckService, UpdateInfo } from "../types";

// 注意：客户端不再参与签名计算。
// 历史问题：曾硬编码 HMAC 密钥 "TavernUpdateCheckSecretSalt" 并在客户端计算签名，
// 但移动端 App 客户端密钥必然可被逆向提取，签名验证机制形同虚设。
// 现架构：客户端只发送 clientVersion + userCredential + timestamp，
// 防刷与防重放由服务端基于 IP 限流 + 时间戳校验统一负责。

export class UpdateCheckService implements IUpdateCheckService {
  name = "updateCheck";
  isCritical = false;
  
  dependencies = [] as const;

  private abortController: AbortController | null = null;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    console.log("[UpdateCheckService] Initializing...");
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
    console.log("[UpdateCheckService] Destroyed.");
  }

  async checkUpdate(currentVersion: string, signal?: AbortSignal, force?: boolean): Promise<UpdateInfo> {
    const activeSignal = signal || this.abortController?.signal;

    // 1. 本地网络环境校验：必须是 wifi 环境下才触发（避免非 wifi 自动下载浪费蜂窝流量）
    let network = "unknown";
    if (typeof navigator !== "undefined") {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
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
    const isTest = typeof process !== "undefined" && process.env && (
      process.env.NODE_ENV === "test" || 
      process.env.VITEST ||
      (process.argv && process.argv.some(arg => arg.includes("run_all_tests")))
    );

    const isDev = typeof window !== "undefined" && window.location && (
      window.location.hostname === "localhost" || 
      window.location.hostname === "127.0.0.1"
    );

    const isDevOrTest = isDev || isTest;

    // 如果未满足环境条件（不是 Wifi 或不是 Android 11+），且非本地开发/测试环境，且非手动强制更新，则不触发更新检测
    if (!force && !isDevOrTest && (!isWifi || !isAndroid11Plus)) {
      console.log(`[UpdateCheckService] Pre-check failed. isWifi=${isWifi}, isAndroid11Plus=${isAndroid11Plus}. Skip update check.`);
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
      !!(window as any).__TAURI_INTERNALS__ ||
      !!(window as any).__TAURI_IPC__
    );

    // 选择目标接口：原生环境直连 FC，浏览器开发环境连本地 server.ts
    // 注意：oss-get-moblie 是更新检查专用 FC 函数；catbot-gmkodirnhh 是 LLM 代理函数，二者不同
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "http://127.0.0.1:3000";
    const url = isClient
      ? "https://oss-get-moblie-pkyxzkhwob.cn-hangzhou.fcapp.run/api/check-update"
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
        console.warn("[UpdateCheckService] Failed to load Tauri native HTTP plugin, fallback to window.fetch");
      }
    }

    try {
      console.log(`[UpdateCheckService] Requesting update check from: ${url}`);
      const response = await fetchFn(url, {
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
      
      // 兼容本地模拟 server.ts 的返回，以及真实的阿里云 FC 返回格式
      // 真实阿里云 FC 返回：{ success: true, data: { latestVersion, downloadUrl, fileName, ... } }
      if (resJson.success && resJson.data) {
        return {
          hasUpdate: true,
          // 优先使用服务端返回的 latestVersion，避免客户端硬编码导致版本不同步
          latestVersion: resJson.data.latestVersion || resJson.latestVersion || "",
          downloadUrl: resJson.data.downloadUrl,
          message: resJson.message
        };
      }
      
      // 本地模拟降级兼容
      return {
        hasUpdate: !!resJson.hasUpdate,
        latestVersion: resJson.latestVersion || "1.6.0",
        downloadUrl: resJson.downloadUrl,
        message: resJson.message
      };

    } catch (e: any) {
      console.error("[UpdateCheckService] Failed to execute update check:", e);
      return {
        hasUpdate: false,
      };
    }
  }
}
