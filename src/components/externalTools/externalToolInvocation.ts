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
