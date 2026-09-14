/**
 * 远程宿主（Headless Host）连接用例：地址规范化与连通性探测。
 *
 * 职责边界：本模块只负责「把用户填的地址规整成可用的 base URL」与「按 Host 协议探活」，
 * 不持有设置状态、不渲染 UI、不做同步编排。设置界面只消费它的返回值。
 *
 * 传输层为什么走 `@tauri-apps/plugin-http`：Android release 包
 * `src-tauri/gen/android/app/build.gradle.kts:20` 将 `usesCleartextTraffic` 固定为 `false`，
 * WebView 直连 `http://192.168.x.x` 会被系统网络明文策略拦截；而 tauri-plugin-http 由
 * Rust reqwest 发出，不受该策略约束。这与 LLM / TTS / ASR 既有做法保持一致，
 * 否则会出现"模型请求能通、连通性测试却失败"的错位。
 */

/** 一次探测的默认超时（毫秒）。用户点了测试按钮就应当在可感知时间内给结论。 */
const DEFAULT_TIMEOUT_MS = 8000;

export interface HostConnectionTarget {
  /** 用户填写的宿主地址，允许省略协议前缀（如 `192.168.1.10:18080`）。 */
  readonly baseUrl: string;
  /** 宿主的 Bearer 凭据；宿主未配置凭据时留空。 */
  readonly accessKey: string;
}

export type HostConnectionFailure =
  | "invalid_url"
  | "unauthorized"
  | "unreachable"
  | "not_a_host";

export interface HostStatusSummary {
  readonly mode: string;
  readonly activeProfile: string;
  readonly charactersCount: number;
  readonly sessionsCount: number;
}

export interface HostConnectionResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly failure?: HostConnectionFailure;
  readonly statusCode?: number;
  readonly summary?: HostStatusSummary;
}

/**
 * 把用户输入规整成 base URL。无法解析时返回 null（界面据此提示，而不是猜一个地址去连）。
 *
 * - `192.168.1.10:18080` → `http://192.168.1.10:18080`
 * - `http://host:18080/` → `http://host:18080`（去掉尾部斜杠，避免拼出 `//health`）
 * - 仅接受 http / https，拒绝其它协议
 */
export function normalizeHostBaseUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

let transportFetch: typeof fetch | null = null;
let transportFetchPromise: Promise<typeof fetch> | null = null;

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__);
}

/** 解析本次探测使用的 fetch 实现；非 Tauri 环境（浏览器 / 测试）直接用全局 fetch。 */
export async function resolveHostTransportFetch(): Promise<typeof fetch> {
  if (!isTauriRuntime()) return fetch;
  if (transportFetch) return transportFetch;
  if (!transportFetchPromise) {
    transportFetchPromise = import("@tauri-apps/plugin-http")
      .then((mod) => {
        transportFetch = mod.fetch;
        return mod.fetch;
      })
      .catch((err) => {
        console.warn("[hostService] 原生 HTTP 插件加载失败，回退到 window.fetch:", err);
        return fetch;
      });
  }
  return transportFetchPromise;
}

function readHostStatusSummary(payload: unknown): HostStatusSummary {
  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const asText = (value: unknown, fallback: string) =>
    typeof value === "string" && value ? value : fallback;
  const asCount = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    mode: asText(record.mode, "unknown"),
    activeProfile: asText(record.activeProfile, "none"),
    charactersCount: asCount(record.charactersCount),
    sessionsCount: asCount(record.sessionsCount),
  };
}

/**
 * 探测宿主连通性。
 *
 * 分两步是为了让失败原因可解释：`/health` 豁免鉴权，先区分"地址不通"与"凭据不对"；
 * 再打 `/api/host/status` 确认对面确实是 Mobile Tavern 宿主（而不是同网段的其它 HTTP 服务）。
 */
export async function testHostConnection(
  target: HostConnectionTarget,
  deps?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<HostConnectionResult> {
  const startedAt = Date.now();
  const baseUrl = normalizeHostBaseUrl(target.baseUrl);
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, failure: "invalid_url" };
  }

  const fetchImpl = deps?.fetchImpl ?? (await resolveHostTransportFetch());
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const elapsed = () => Date.now() - startedAt;

  try {
    const health = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (!health.ok) {
      return {
        ok: false,
        latencyMs: elapsed(),
        statusCode: health.status,
        failure: health.status === 401 || health.status === 403 ? "unauthorized" : "not_a_host",
      };
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    const accessKey = (target.accessKey ?? "").trim();
    if (accessKey) headers.Authorization = `Bearer ${accessKey}`;

    const status = await fetchImpl(`${baseUrl}/api/host/status`, {
      headers,
      signal: controller.signal,
    });
    if (status.status === 401 || status.status === 403) {
      return { ok: false, latencyMs: elapsed(), statusCode: status.status, failure: "unauthorized" };
    }
    if (!status.ok) {
      return { ok: false, latencyMs: elapsed(), statusCode: status.status, failure: "not_a_host" };
    }

    return {
      ok: true,
      latencyMs: elapsed(),
      summary: readHostStatusSummary(await status.json()),
    };
  } catch {
    // 网络不可达、DNS 失败、超时 abort 都归为不可达；细节对用户无区分价值。
    return { ok: false, latencyMs: elapsed(), failure: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
