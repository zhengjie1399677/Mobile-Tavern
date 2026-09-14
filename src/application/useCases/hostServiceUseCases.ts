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
import type { BackupMergeStats } from "./backupMerge";

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

/**
 * 备份传输比探活慢得多：附件以 base64 内联，单个备份可达数十 MB，
 * 因此给独立的长超时，避免「连接正常但传输被 8 秒掐断」。
 */
const DEFAULT_TRANSFER_TIMEOUT_MS = 60_000;

export type HostSnapshotFailure =
  | "invalid_url"
  | "unauthorized"
  | "unreachable"
  | "payload_too_large"
  | "rejected"
  | "empty_response";

export interface HostSnapshotTransferResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly failure?: HostSnapshotFailure;
  readonly statusCode?: number;
  /** 宿主返回的错误说明，用于可解释提示。 */
  readonly detail?: string;
  /** 宿主导出的备份原文（仅拉取成功时）。 */
  readonly text?: string;
  /** 传输体量（字符数），用于提示与诊断。 */
  readonly bytes?: number;
  /** 宿主以合并模式处理时返回的变更统计，用于说明"宿主那边改了什么"。 */
  readonly mergeStats?: BackupMergeStats;
}

function buildHostHeaders(accessKey: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (contentType) headers["Content-Type"] = contentType;
  const key = (accessKey ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function classifyHostStatus(status: number): HostSnapshotFailure {
  if (status === 401 || status === 403) return "unauthorized";
  // 宿主 express.json 上限 50mb；超限时给出可区分的失败原因，而不是笼统「失败」。
  if (status === 413) return "payload_too_large";
  return "rejected";
}

/** 读取宿主错误响应里的说明文本；非 JSON 时回退到原文片段。 */
async function readHostErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const raw = await res.text();
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const error = (parsed as Record<string, unknown>).error;
        if (typeof error === "string") return error;
        if (error && typeof error === "object") {
          const message = (error as Record<string, unknown>).message;
          if (typeof message === "string") return message;
        }
      }
    } catch {
      // 非 JSON 响应直接返回原文片段。
    }
    return raw.slice(0, 300);
  } catch {
    return undefined;
  }
}

/**
 * 拉取宿主快照原文（`POST /api/host/backup/export`）。
 *
 * 只负责拿到宿主当前的统一备份文本，不做解析、不落盘；解析与「保留本机设置」
 * 由 hostSnapshotSync 编排层处理，保证「拿到什么」与「怎么用」分开。
 */
export async function exportHostSnapshot(
  target: HostConnectionTarget,
  deps?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<HostSnapshotTransferResult> {
  const startedAt = Date.now();
  const baseUrl = normalizeHostBaseUrl(target.baseUrl);
  if (!baseUrl) return { ok: false, latencyMs: 0, failure: "invalid_url" };

  const fetchImpl = deps?.fetchImpl ?? (await resolveHostTransportFetch());
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps?.timeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
  );
  const elapsed = () => Date.now() - startedAt;

  try {
    const res = await fetchImpl(`${baseUrl}/api/host/backup/export`, {
      method: "POST",
      headers: buildHostHeaders(target.accessKey),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: elapsed(),
        statusCode: res.status,
        failure: classifyHostStatus(res.status),
        detail: await readHostErrorDetail(res),
      };
    }
    const text = await res.text();
    if (!text.trim()) {
      return {
        ok: false,
        latencyMs: elapsed(),
        statusCode: res.status,
        failure: "empty_response",
      };
    }
    return {
      ok: true,
      latencyMs: elapsed(),
      statusCode: res.status,
      text,
      bytes: text.length,
    };
  } catch {
    return { ok: false, latencyMs: elapsed(), failure: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把统一备份文本推送给宿主（`POST /api/host/backup/import`）。
 *
 * 宿主侧会整体覆盖其快照（replaceFromBackup + 落盘）。`preserveReceiverSettings`
 * 默认为 true，对应宿主的 `?preserveSettings=true`：跨设备同步时必须开启 ——
 * 宿主导出的快照是脱敏的，任何"由发送端携带 settings"的写法都会抹掉接收端凭据。
 */
export async function importSnapshotToHost(
  target: HostConnectionTarget,
  payloadText: string,
  deps?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** 是否要求宿主保留自己的设置；默认 true（安全默认值）。仅覆盖模式使用。 */
    preserveReceiverSettings?: boolean;
    /** 导入语义；`merge` 让宿主把本次快照并进现有数据，而不是整体替换。 */
    mode?: "replace" | "merge";
  },
): Promise<HostSnapshotTransferResult> {
  const startedAt = Date.now();
  const baseUrl = normalizeHostBaseUrl(target.baseUrl);
  if (!baseUrl) return { ok: false, latencyMs: 0, failure: "invalid_url" };

  const mode = deps?.mode === "merge" ? "merge" : "replace";
  const preserveReceiverSettings = deps?.preserveReceiverSettings !== false;
  // 合并模式下宿主无条件保留自己的设置，无需再传 preserveSettings；
  // 只带必要参数，协议在日志里也更容易读。
  const query = new URLSearchParams();
  if (mode === "merge") query.set("mode", "merge");
  else if (preserveReceiverSettings) query.set("preserveSettings", "true");
  const queryText = query.toString();
  const importUrl = `${baseUrl}/api/host/backup/import${queryText ? `?${queryText}` : ""}`;

  const fetchImpl = deps?.fetchImpl ?? (await resolveHostTransportFetch());
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps?.timeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS,
  );
  const elapsed = () => Date.now() - startedAt;

  try {
    const res = await fetchImpl(importUrl, {
      method: "POST",
      headers: buildHostHeaders(target.accessKey, "application/json"),
      body: payloadText,
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: elapsed(),
        statusCode: res.status,
        failure: classifyHostStatus(res.status),
        detail: await readHostErrorDetail(res),
      };
    }
    const mergeStats = mode === "merge" ? await readMergeStats(res) : undefined;
    return {
      ok: true,
      latencyMs: elapsed(),
      statusCode: res.status,
      bytes: payloadText.length,
      ...(mergeStats ? { mergeStats } : {}),
    };
  } catch {
    return { ok: false, latencyMs: elapsed(), failure: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取宿主返回的合并统计。
 *
 * 统计只用于说明"宿主那边改了什么"，缺失或结构异常都不应改变同步本身的成功结论，
 * 因此解析失败一律吞掉并返回 undefined。
 */
async function readMergeStats(res: Response): Promise<BackupMergeStats | undefined> {
  try {
    const body = await res.json() as { mergeStats?: BackupMergeStats };
    return body?.mergeStats;
  } catch {
    return undefined;
  }
}
