/**
 * 第三方 MCP 配置解析器与社区预置模板。
 *
 * 遵循 COMPAT-DATA：纯中立数据解析，不执行任何外部脚本，
 * 兼容 Claude Desktop / Cursor / VSCode / Cline 的 mcpServers 配置格式。
 */
import type {
  ExternalAuthScheme,
  ExternalCapabilitySource,
  ExternalProtocolEra,
} from "../../domain/externalSources/contracts";

export interface ParsedMcpSourceCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly endpoint: string;
  readonly era: ExternalProtocolEra;
  readonly authHeader?: string;
  readonly authScheme?: ExternalAuthScheme;
  readonly rawSecret?: string;
}

export interface SkippedMcpConfigEntry {
  readonly key: string;
  readonly reason: string;
}

export interface ParseThirdPartyMcpResult {
  readonly valid: boolean;
  readonly candidates: readonly ParsedMcpSourceCandidate[];
  readonly skipped: readonly SkippedMcpConfigEntry[];
  readonly error?: string;
}

export interface ThirdPartyMcpPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly endpoint: string;
  readonly era: ExternalProtocolEra;
  readonly requiresAuth: boolean;
  readonly authHeader?: string;
  readonly authScheme?: ExternalAuthScheme;
  readonly authPlaceholder?: string;
  readonly tags: readonly string[];
  /** 用途分组：角色扮演用户优先看到前两组，开发向默认折叠。 */
  readonly category: ThirdPartyMcpPresetCategory;
}

/** 预置模板的用途分组。 */
export type ThirdPartyMcpPresetCategory = "roleplay" | "general" | "developer";

export const THIRD_PARTY_MCP_PRESET_CATEGORY_LABEL: Record<ThirdPartyMcpPresetCategory, string> = {
  roleplay: "角色扮演向",
  general: "通用查询",
  developer: "开发向",
};

/**
 * 手动/预置表单的字段值。
 *
 * 与 `formValuesToCandidate` 成对存在：新增字段必须先加到这里，转换处才不会再漏——
 * 「预置模板声明了 `x-subscription-token` 却按 `Authorization: Bearer` 发出」正是
 * 转换处漏字段造成的。
 */
export interface McpSourceFormValues {
  readonly id: string;
  readonly displayName: string;
  readonly endpoint: string;
  readonly era: ExternalProtocolEra;
  readonly authHeader?: string;
  readonly authScheme?: ExternalAuthScheme;
  /** 仅用于界面提示的鉴权占位文案，不参与落库。 */
  readonly authPlaceholder?: string;
  readonly token?: string;
}

export const THIRD_PARTY_MCP_PRESETS: readonly ThirdPartyMcpPreset[] = Object.freeze([
  {
    id: "deepwiki",
    name: "DeepWiki 文档检索",
    description: "公网免鉴权文档检索与知识库 MCP 服务，开箱即用（偏技术文档）",
    endpoint: "https://mcp.deepwiki.com/mcp",
    era: "auto",
    requiresAuth: false,
    tags: ["知识库", "免鉴权", "已验证"],
    category: "general",
  },
  {
    id: "mcp-wiki",
    name: "Wiki 知识检索",
    description: "公网免鉴权知识 / 词条检索（search + 文档查询），可用于设定考据与背景补充",
    endpoint: "https://mcp.wiki/mcp",
    era: "auto",
    requiresAuth: false,
    tags: ["知识检索", "免鉴权", "已验证"],
    category: "roleplay",
  },
  {
    id: "brave-search",
    name: "Brave Search 远程搜索",
    description: "Brave 搜索服务（需输入 API Key）",
    endpoint: "https://api.search.brave.com/mcp",
    era: "auto",
    requiresAuth: true,
    authHeader: "x-subscription-token",
    authScheme: "raw",
    authPlaceholder: "粘贴 Brave Search API Key (BSA...)",
    tags: ["联网搜索", "外部服务"],
    category: "general",
  },
  {
    id: "grep-app-code-search",
    name: "grep.app 代码搜索",
    description: "公网免鉴权 GitHub 代码搜索，可直接检索公开仓库代码片段与用法",
    endpoint: "https://mcp.grep.app",
    era: "auto",
    requiresAuth: false,
    tags: ["代码搜索", "免鉴权", "已验证"],
    category: "developer",
  },
  {
    id: "gitmcp-repo-docs",
    name: "GitMCP 仓库文档",
    description: "公网免鉴权仓库文档检索；端点可改为 https://gitmcp.io/<owner>/<repo> 指向任意公开仓库",
    endpoint: "https://gitmcp.io/docs",
    era: "auto",
    requiresAuth: false,
    tags: ["仓库文档", "免鉴权", "已验证"],
    category: "developer",
  },
  {
    id: "github-remote",
    name: "GitHub 远端探针",
    description: "GitHub 远程代码检索与公开仓库只读探针",
    endpoint: "https://api.githubcopilot.com/mcp",
    era: "modern",
    requiresAuth: true,
    authHeader: "Authorization",
    authScheme: "bearer",
    authPlaceholder: "粘贴 GitHub Personal Access Token (ghp_...)",
    tags: ["开发", "代码仓库"],
    category: "developer",
  },
]);

function sanitizeId(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `mcp-source-${Date.now().toString(36)}`;
}

/** 用预置模板填充表单：鉴权头 / 鉴权方案 / 占位提示随模板一起带入。 */
export function presetToFormValues(preset: ThirdPartyMcpPreset): McpSourceFormValues {
  return {
    id: preset.id,
    displayName: preset.name,
    endpoint: preset.endpoint,
    era: preset.era,
    ...(preset.authHeader ? { authHeader: preset.authHeader } : {}),
    ...(preset.authScheme ? { authScheme: preset.authScheme } : {}),
    ...(preset.authPlaceholder ? { authPlaceholder: preset.authPlaceholder } : {}),
    token: "",
  };
}

/** 表单 → 可保存候选：authHeader / authScheme 必须原样带出，否则凭据会写进错误的请求头。 */
export function formValuesToCandidate(values: McpSourceFormValues): ParsedMcpSourceCandidate {
  const token = values.token?.trim() ?? "";
  const id = values.id.trim();
  return {
    id,
    displayName: values.displayName.trim() || id,
    endpoint: values.endpoint.trim(),
    era: values.era,
    ...(values.authHeader ? { authHeader: values.authHeader } : {}),
    ...(values.authScheme ? { authScheme: values.authScheme } : {}),
    rawSecret: token ? token : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHeaders(headers: unknown): {
  authHeader?: string;
  authScheme?: ExternalAuthScheme;
  rawSecret?: string;
} {
  if (!isRecord(headers)) return {};
  for (const [key, val] of Object.entries(headers)) {
    if (typeof val !== "string" || !val.trim()) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "authorization") {
      const trimmed = val.trim();
      if (trimmed.toLowerCase().startsWith("bearer ")) {
        return {
          authHeader: "Authorization",
          authScheme: "bearer",
          rawSecret: trimmed.slice(7).trim(),
        };
      }
      return {
        authHeader: "Authorization",
        authScheme: "raw",
        rawSecret: trimmed,
      };
    }
    if (
      lowerKey.includes("key") ||
      lowerKey.includes("token") ||
      lowerKey.includes("secret") ||
      lowerKey.startsWith("x-")
    ) {
      return {
        authHeader: key,
        authScheme: "raw",
        rawSecret: val.trim(),
      };
    }
  }
  return {};
}

/**
 * 解析来自第三方配置（Claude Desktop / Cursor mcpServers JSON 或单行 URL）。
 */
export function parseThirdPartyMcpConfig(input: string): ParseThirdPartyMcpResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, candidates: [], skipped: [], error: "输入内容为空" };
  }

  // 1. 直接以 http/https 开头的单个 URL 快捷解析
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const hostPart = url.hostname.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      return {
        valid: true,
        candidates: [
          {
            id: sanitizeId(hostPart),
            displayName: url.hostname,
            endpoint: trimmed,
            era: "auto",
          },
        ],
        skipped: [],
      };
    } catch {
      return { valid: false, candidates: [], skipped: [], error: "无效的 URL 格式" };
    }
  }

  // 2. JSON 格式解析（支持 claude_desktop_config / Cursor mcpServers）
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return {
      valid: false,
      candidates: [],
      skipped: [],
      error: `JSON 格式错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!isRecord(json)) {
    return { valid: false, candidates: [], skipped: [], error: "JSON 根节点必须为对象" };
  }

  // 判定是否是嵌套在 mcpServers 下，或是直接 server map
  const serverMap: Record<string, unknown> = isRecord(json.mcpServers)
    ? (json.mcpServers as Record<string, unknown>)
    : json;

  const candidates: ParsedMcpSourceCandidate[] = [];
  const skipped: SkippedMcpConfigEntry[] = [];

  for (const [key, item] of Object.entries(serverMap)) {
    if (!isRecord(item)) {
      skipped.push({ key, reason: "配置条目必须为对象" });
      continue;
    }

    // 检查是否具备 remote URL
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (url && /^https?:\/\//i.test(url)) {
      const auth = parseHeaders(item.headers);
      candidates.push({
        id: sanitizeId(key),
        displayName: key,
        endpoint: url,
        era: "auto",
        ...auth,
      });
      continue;
    }

    // 针对 stdio 命令行进程的友好拦截提醒
    if (typeof item.command === "string" || Array.isArray(item.args)) {
      skipped.push({
        key,
        reason: "stdio 本地进程在移动端不可运行，请使用 HTTP/HTTPS 远程端点",
      });
      continue;
    }

    skipped.push({ key, reason: "缺少有效的 http/https url 端点" });
  }

  if (candidates.length === 0 && skipped.length === 0) {
    return {
      valid: false,
      candidates: [],
      skipped: [],
      error: "未找到任何可识别的 MCP 服务配置",
    };
  }

  return {
    valid: candidates.length > 0,
    candidates,
    skipped,
  };
}

/** 把候选配置转化为符合 ExternalCapabilitySource 规范的对象。 */
export function candidateToExternalSource(
  candidate: ParsedMcpSourceCandidate,
): ExternalCapabilitySource {
  return {
    schemaVersion: 1,
    id: candidate.id,
    kind: "mcp",
    displayName: candidate.displayName || candidate.id,
    endpoint: candidate.endpoint,
    transport: "streamable-http",
    era: candidate.era,
    authHeader: candidate.authHeader,
    authScheme: candidate.authScheme,
    enabled: true,
  };
}
