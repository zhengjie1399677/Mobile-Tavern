import type { ProviderFamily, ProviderIdentity } from "./types";

const OFFICIAL_HOST_FAMILIES: ReadonlyArray<readonly [string, ProviderFamily]> = [
  ["api.openai.com", "openai"],
  ["api.anthropic.com", "anthropic"],
  ["api.deepseek.com", "deepseek"],
  ["generativelanguage.googleapis.com", "gemini"],
  ["open.bigmodel.cn", "glm"],
  ["api.z.ai", "glm"],
  ["dashscope.aliyuncs.com", "qwen"],
  ["dashscope-intl.aliyuncs.com", "qwen"],
];

export function resolveProviderIdentity(baseUrl?: string, modelId = ""): ProviderIdentity {
  const normalizedUrl = normalizeProviderUrl(baseUrl);
  const hostname = normalizedUrl?.hostname.toLowerCase() ?? "";
  const officialFamily = OFFICIAL_HOST_FAMILIES.find(([host]) =>
    hostname === host || hostname.endsWith(`.${host}`),
  )?.[1];
  const family = officialFamily ?? inferProviderFamilyFromModel(modelId);
  const origin = normalizedUrl?.origin.toLowerCase() ?? normalizeOpaqueEndpoint(baseUrl);
  return {
    family,
    origin,
    scopeKey: normalizedUrl ? normalizeEndpointScope(normalizedUrl) : origin || "endpoint:unspecified",
    official: officialFamily !== undefined,
  };
}

function normalizeEndpointScope(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin.toLowerCase()}${pathname === "/" ? "" : pathname}`;
}

export function inferProviderFamilyFromModel(modelId: string): ProviderFamily {
  const model = modelId.trim().toLowerCase();
  const leaf = model.includes("/") ? model.split("/").at(-1) ?? model : model;
  if (model.startsWith("anthropic/") || leaf.startsWith("claude-")) return "anthropic";
  if (model.startsWith("deepseek/") || leaf.startsWith("deepseek-") || leaf === "deepseek") return "deepseek";
  if (model.startsWith("zhipu/") || model.startsWith("glm/") || leaf.startsWith("glm-")) return "glm";
  if (model.startsWith("qwen/") || leaf.startsWith("qwen-") || leaf.startsWith("qwq-")) return "qwen";
  if (model.startsWith("google/") || leaf.startsWith("gemini-")) return "gemini";
  if (model.startsWith("openai/") || /^(gpt-|o\d(?:-|$))/.test(leaf)) return "openai";
  return "other";
}

function normalizeProviderUrl(baseUrl?: string): URL | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function normalizeOpaqueEndpoint(baseUrl?: string): string {
  const value = baseUrl?.trim().toLowerCase().replace(/\/+$/, "") ?? "";
  return value ? `endpoint:${value}` : "";
}
