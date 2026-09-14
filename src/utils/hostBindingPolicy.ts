/**
 * 无头宿主「监听绑定」策略：UI 与 `headless/config.ts` 共用的单一来源。
 *
 * 为什么必须共用：`headless/config.ts` 的启动闸门（监听非回环地址却没有凭据时拒绝启动）
 * 与设置界面里的风险提示，如果各写一套判断，必然漂移 —— 界面显示"可以启动"、真实进程却拒绝启动，
 * 是这类监听配置最容易出的问题。headless 侧已经直接复用 `src/` 下的 kernel / runtime / logger，
 * 所以把规则收敛到本模块成本很低。
 *
 * 本模块必须保持纯函数、零副作用、零平台依赖：它同时被 WebView 与 Node 进程导入。
 */

/** 只对本机可见的监听地址。 */
export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1", "localhost"];

/** 绑定全部网卡。风险高于指定单个局域网地址（会同时暴露热点/公网可达网卡）。 */
export const ALL_INTERFACES_HOST = "0.0.0.0";

export const DEFAULT_HEADLESS_PORT = 18080;

/** 对外监听时要求的最小凭据长度；低于此值视为弱凭据。 */
export const MIN_ACCESS_KEY_LENGTH = 16;

/** 生成的凭据字节数（输出 2 倍长度的十六进制串）。 */
export const ACCESS_KEY_BYTES = 24;

export function normalizeHost(host: string | undefined | null): string {
  return (host ?? "").trim().toLowerCase();
}

/** 判断监听地址是否只对本机可见。与 `headless/config.ts` 的启动闸门使用同一实现。 */
export function isLoopbackHost(host: string | undefined | null): boolean {
  return LOOPBACK_HOSTS.includes(normalizeHost(host));
}

export function isAllInterfacesHost(host: string | undefined | null): boolean {
  return normalizeHost(host) === ALL_INTERFACES_HOST;
}

/** 合法 TCP 端口（1~65535 的整数）。 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** 解析端口输入框：非法返回 null，交由界面提示而不是静默回退成默认值。 */
export function parsePortInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return isValidPort(parsed) ? parsed : null;
}

/** 解析逗号分隔的 CORS 白名单（支持中英文逗号与分号）。 */
export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(/[,，;；\n]/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function formatCorsOrigins(origins: readonly string[]): string {
  return origins.join(", ");
}

/**
 * 生成高强度访问凭据（十六进制）。
 *
 * 使用 `globalThis.crypto.getRandomValues`：WebView 与 Node 18+ 均可用。
 * 不接受 `Math.random()` 兜底 —— 用弱随机数生成的对外凭据比没有凭据更危险。
 */
export function generateAccessKey(bytes: number = ACCESS_KEY_BYTES): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("当前运行环境不支持安全随机数，无法生成访问凭据。");
  }
  const buffer = new Uint8Array(bytes);
  cryptoApi.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface HostBindingDraft {
  readonly bindHost: string;
  readonly bindPort: number;
  readonly accessKey: string;
  readonly corsOrigins: readonly string[];
}

export type HostBindingIssueLevel = "warning" | "error";

export type HostBindingIssueCode =
  | "host_required"
  | "port_invalid"
  | "non_loopback_without_key"
  | "weak_access_key"
  | "all_interfaces_exposed"
  | "lan_exposed_cleartext"
  | "wildcard_cors";

export interface HostBindingIssue {
  readonly level: HostBindingIssueLevel;
  /** 稳定 code，供 i18n 映射与测试断言，不依赖自然语言文案。 */
  readonly code: HostBindingIssueCode;
  /** 可选上下文（如具体地址、长度），由界面插值。 */
  readonly detail?: string;
}

export interface HostBindingAssessment {
  readonly level: "ok" | HostBindingIssueLevel;
  /** 是否允许宿主按此配置启动；必须与 `headless/config.ts` 的闸门判断一致。 */
  readonly allowed: boolean;
  readonly issues: readonly HostBindingIssue[];
}

/**
 * 评估一份监听配置。
 *
 * 与 `headless/config.ts` 的启动闸门严格对齐：`allowed === false` 等价于该配置会启动失败。
 * 其余为"能启动但需要用户知情"的警告（明文传输、全网卡暴露、弱凭据、通配 CORS）。
 */
export function evaluateHostBinding(draft: HostBindingDraft): HostBindingAssessment {
  const issues: HostBindingIssue[] = [];
  const host = normalizeHost(draft.bindHost);
  const accessKey = (draft.accessKey ?? "").trim();

  if (!host) {
    issues.push({ level: "error", code: "host_required" });
  }
  if (!isValidPort(draft.bindPort)) {
    issues.push({ level: "error", code: "port_invalid", detail: String(draft.bindPort) });
  }

  if (host && !isLoopbackHost(host)) {
    if (!accessKey) {
      // 与 headless 启动闸门同义：非回环 + 无凭据 = 拒绝启动。
      issues.push({ level: "error", code: "non_loopback_without_key", detail: host });
    } else {
      issues.push({ level: "warning", code: "lan_exposed_cleartext" });
      if (accessKey.length < MIN_ACCESS_KEY_LENGTH) {
        issues.push({
          level: "warning",
          code: "weak_access_key",
          detail: String(accessKey.length),
        });
      }
    }
    if (isAllInterfacesHost(host)) {
      issues.push({ level: "warning", code: "all_interfaces_exposed" });
    }
  }

  if (draft.corsOrigins.some((origin) => origin.trim() === "*")) {
    // 修复过 CORS 通配回显，不能又从界面配回来。
    issues.push({ level: "warning", code: "wildcard_cors" });
  }

  const hasError = issues.some((issue) => issue.level === "error");
  return {
    level: hasError ? "error" : issues.length > 0 ? "warning" : "ok",
    allowed: !hasError,
    issues,
  };
}

/**
 * 生成写入宿主机器 `.env` 的配置块。
 *
 * `headless/main.ts` 启动时会 `dotenv.config()`，所以把这几行写进宿主仓库根目录的 `.env`
 * 再执行 `npm run headless` 即可生效；环境变量优先级高于任何界面配置。
 */
export function buildHeadlessEnvText(draft: HostBindingDraft): string {
  const host = normalizeHost(draft.bindHost) || "127.0.0.1";
  const port = isValidPort(draft.bindPort) ? draft.bindPort : DEFAULT_HEADLESS_PORT;
  const origins = draft.corsOrigins.map((origin) => origin.trim()).filter(Boolean).join(",");
  return [
    `HEADLESS_HOST=${host}`,
    `HEADLESS_PORT=${port}`,
    `HEADLESS_API_KEY=${(draft.accessKey ?? "").trim()}`,
    `HEADLESS_CORS_ORIGINS=${origins}`,
  ].join("\n");
}
