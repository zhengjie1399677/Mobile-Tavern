/**
 * 聊天内 MCP 显性调用的纯逻辑：主参数推导、结果序列化与送入对话的格式化。
 * 与 UI 解耦，便于单测；界面组件（气泡弹层）只负责收集意图。
 */
import type { ExternalToolDescriptor } from "../../domain/externalSources/contracts";

export interface ExternalToolInvocationTarget {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly tool: ExternalToolDescriptor;
}

export interface ExternalToolInvocationPayload {
  readonly target: ExternalToolInvocationTarget;
  readonly input: Record<string, unknown>;
  readonly query: string;
  readonly resultText: string;
  readonly durationMs: number;
}

/** 送入对话的工具结果最大长度；超出即截断，避免一次调用撑爆上下文。 */
export const EXTERNAL_TOOL_RESULT_MAX_CHARS = 6000;

export type ToolArgumentType = "string" | "number" | "boolean" | "json";

/** 工具入参表单字段：由工具 JSON Schema 投影而来。 */
export interface ToolArgumentField {
  readonly key: string;
  readonly type: ToolArgumentType;
  readonly required: boolean;
  readonly description?: string;
  /** 是否为可被输入框草稿自动带入的查询类字段。 */
  readonly primary: boolean;
}

const PREFERRED_ARGUMENT_KEYS = [
  "query",
  "prompt",
  "question",
  "q",
  "search",
  "keyword",
  "keywords",
  "text",
  "url",
  "topic",
] as const;

/** 从工具的 JSON Schema 推导"用户查询"应写入哪个参数。 */
export function resolvePrimaryArgumentKey(
  schema: Readonly<Record<string, unknown>> | undefined,
): string | null {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const propertyMap = properties as Record<string, unknown>;
  const keys = Object.keys(propertyMap);
  for (const candidate of PREFERRED_ARGUMENT_KEYS) {
    if (keys.includes(candidate)) return candidate;
  }
  for (const key of keys) {
    const descriptor = propertyMap[key];
    if (
      descriptor
      && typeof descriptor === "object"
      && !Array.isArray(descriptor)
      && (descriptor as { type?: unknown }).type === "string"
    ) {
      return key;
    }
  }
  return keys[0] ?? null;
}

/**
 * 把工具 JSON Schema 投影成参数表单。
 *
 * 只做单层投影：顶层 required 优先排序，string/number/boolean 直接渲染输入控件，
 * object/array 走 JSON 文本。这样 GitMCP 这类"owner + repo + query"多参数工具
 * 不会因为只填一个主参数而被服务端以 -32602 拒绝。
 */
export function listToolArgumentFields(
  schema: Readonly<Record<string, unknown>> | undefined,
): ToolArgumentField[] {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = Array.isArray(schema?.required)
    ? (schema?.required as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const primaryKey = resolvePrimaryArgumentKey(schema);
  return Object.entries(properties as Record<string, unknown>)
    .map(([key, descriptor]) => {
      const record = descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)
        ? descriptor as Record<string, unknown>
        : {};
      const declared = record.type;
      const type: ToolArgumentType = declared === "number" || declared === "integer"
        ? "number"
        : declared === "boolean"
          ? "boolean"
          : declared === "object" || declared === "array"
            ? "json"
            : "string";
      return {
        key,
        type,
        required: required.includes(key),
        description: typeof record.description === "string" ? record.description : undefined,
        primary: key === primaryKey,
      } satisfies ToolArgumentField;
    })
    .sort((left, right) => Number(right.required) - Number(left.required));
}

/**
 * 用输入框草稿推导初始参数：
 *   - 查询类字段（query/prompt/...）直接带入草稿；
 *   - 草稿里出现 `owner/repo` 形态时自动拆分给 owner / repo；
 *   - 草稿里出现 URL 时带入 url 字段。
 */
export function deriveInitialToolArguments(
  schema: Readonly<Record<string, unknown>> | undefined,
  draftText: string | undefined,
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  const text = (draftText ?? "").trim();
  const fields = listToolArgumentFields(schema);
  if (fields.length === 0) return values;
  const keys = new Set(fields.map((field) => field.key.toLowerCase()));
  for (const field of fields) {
    if (field.type !== "boolean" && field.required && !values[field.key]) values[field.key] = "";
  }
  if (!text) return values;

  const primary = resolvePrimaryArgumentKey(schema);
  if (primary && fields.some((field) => field.key === primary)) {
    values[primary] = text;
  }
  const pair = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/.exec(text);
  if (pair) {
    const ownerKey = fields.find((field) => field.key.toLowerCase() === "owner")?.key;
    const repoKey = fields.find((field) => field.key.toLowerCase() === "repo")?.key;
    if (ownerKey && !String(values[ownerKey] ?? "").trim()) values[ownerKey] = pair[1];
    if (repoKey && !String(values[repoKey] ?? "").trim()) values[repoKey] = pair[2];
  }
  const url = /(https?:\/\/\S+)/i.exec(text);
  const urlKey = fields.find((field) => field.key.toLowerCase() === "url")?.key;
  if (url && urlKey && !String(values[urlKey] ?? "").trim()) values[urlKey] = url[1];
  return values;
}

/** 把表单值转成工具调用参数：跳过空值，数字/布尔/JSON 做类型转换。 */
export function buildToolArguments(
  fields: readonly ToolArgumentField[],
  values: Readonly<Record<string, string | boolean>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.type === "boolean") {
      result[field.key] = value === true;
      continue;
    }
    const raw = typeof value === "string" ? value.trim() : value;
    if (raw === "") continue;
    if (field.type === "number") {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) result[field.key] = numeric;
      continue;
    }
    if (field.type === "json") {
      try {
        result[field.key] = JSON.parse(String(raw));
      } catch {
        // 非法 JSON 由调用方在提交前拦截；这里保持宽松，不阻塞其他参数。
      }
      continue;
    }
    result[field.key] = raw;
  }
  return result;
}

/** 返回缺失的必填参数名（用于调用前校验）。 */
export function findMissingRequiredArguments(
  fields: readonly ToolArgumentField[],
  values: Readonly<Record<string, string | boolean>>,
): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = values[field.key];
      if (value === undefined) return true;
      if (typeof value === "string") return value.trim() === "";
      return false;
    })
    .map((field) => field.key);
}

/** 把工具返回值转成可读文本。 */
export function stringifyExternalToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/** 组装送入对话的工具结果消息（模型与用户都能看到）。 */
export function formatExternalToolResultForConversation(
  payload: ExternalToolInvocationPayload,
): string {
  const raw = payload.resultText;
  const truncated = raw.length > EXTERNAL_TOOL_RESULT_MAX_CHARS
    ? `${raw.slice(0, EXTERNAL_TOOL_RESULT_MAX_CHARS)}\n…（结果过长已截断）`
    : raw;
  const args = JSON.stringify(payload.input);
  const cost = Number.isFinite(payload.durationMs) ? `，耗时 ${payload.durationMs}ms` : "";
  return [
    `【外部能力结果 · ${payload.target.sourceName}/${payload.target.tool.localName}】${cost}`,
    `调用参数：${args}`,
    "结果：",
    truncated,
  ].join("\n");
}
