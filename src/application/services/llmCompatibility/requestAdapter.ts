import type { Message } from "../../../types";
import type { OpenAiProviderMessage } from "../../useCases/multimodalProviderProjection";
import { cleanRequestPayload } from "../requestSchema";
import { ModelCapabilityRegistry } from "./ModelCapabilityRegistry";
import { resolveProviderIdentity } from "./providerIdentity";

export interface PrepareProviderRequestOptions {
  baseUrl?: string;
  modelId: string;
  request: Record<string, unknown>;
  disableReasoning?: boolean;
  forceBasicParams?: boolean;
}

/** 请求白名单、模型能力与 Provider 方言只在这一层组合，调用方不再拼接兼容分支。 */
export function prepareProviderRequest(options: PrepareProviderRequestOptions): Record<string, unknown> {
  const identity = resolveProviderIdentity(options.baseUrl, options.modelId);
  const whitelisted = cleanRequestPayload(options.baseUrl, options.request) ?? {};
  if (options.disableReasoning) {
    Object.assign(
      whitelisted,
      ModelCapabilityRegistry.getReasoningDisableParams(options.modelId, options.baseUrl),
    );
  }
  const cleaned = ModelCapabilityRegistry.cleanLLMParams(
    options.modelId,
    whitelisted,
    options.baseUrl,
    options.forceBasicParams,
  );

  // DeepSeek thinking + tools 不接受 tool_choice；省略等价于 auto。
  if (identity.official && identity.family === "deepseek" && Array.isArray(cleaned.tools)) {
    delete cleaned.tool_choice;
  }
  if (Array.isArray(cleaned.messages)) {
    cleaned.messages = normalizeProviderMessages(cleaned.messages, identity.family);
  }
  return cleaned;
}

/**
 * Preserved Thinking 适配：按相同可见文本的出现顺序回填，避免重复对白被 Map 覆盖。
 * 仅向声明该方言的模型族添加 reasoning_content，未知模型保持原请求。
 */
export function preserveAssistantReasoning(
  providerMessages: readonly OpenAiProviderMessage[],
  sessionMessages: readonly Message[],
  baseUrl?: string,
  modelId = "",
): OpenAiProviderMessage[] {
  const family = resolveProviderIdentity(baseUrl, modelId).family;
  if (family !== "deepseek" && family !== "glm" && family !== "qwen") {
    return providerMessages.map(cloneProviderMessage);
  }

  const reasoningCandidates = sessionMessages.flatMap((message) => {
    if (message.sender !== "assistant" || !message.reasoningContent) return [];
    return [{
      content: message.content,
      reasoning: message.reasoningContent,
      toolCallKey: readLegacyToolCallKey(message.extra),
      used: false,
    }];
  });

  return providerMessages.map((message) => {
    const cloned = cloneProviderMessage(message);
    if (cloned.role !== "assistant") return cloned;
    const toolCallKey = providerToolCallKey(cloned);
    const candidate = reasoningCandidates.find((item) => !item.used && (
      typeof cloned.content === "string"
        ? item.content === cloned.content
        : cloned.content === null && toolCallKey !== null
          ? item.toolCallKey === toolCallKey || (!item.toolCallKey && item.content === "")
          : false
    ));
    if (!candidate) return cloned;
    candidate.used = true;
    return { ...cloned, reasoning_content: candidate.reasoning };
  });
}

export function removeUnsupportedRequestFields(
  request: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> {
  const next = { ...request };
  for (const field of fields) delete next[field];
  return next;
}

function normalizeProviderMessages(messages: unknown[], family: string): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const record = { ...(message as Record<string, unknown>) };
    if (
      family === "deepseek"
      && record.role === "assistant"
      && Array.isArray(record.tool_calls)
      && record.content == null
    ) {
      record.content = "";
    }
    return record;
  });
}

function cloneProviderMessage(message: OpenAiProviderMessage): OpenAiProviderMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => structuredClone(part))
      : message.content,
    tool_calls: message.tool_calls?.map((call) => ({
      ...call,
      function: { ...call.function },
    })),
  };
}

function providerToolCallKey(message: OpenAiProviderMessage): string | null {
  if (!message.tool_calls?.length) return null;
  const ids = message.tool_calls.map((call) => call.id).filter(Boolean);
  return ids.length === message.tool_calls.length ? ids.join("\u0000") : null;
}

/** 只读取旧导入数据中的 Provider Tool Call ID；新领域消息不持久化 Provider 方言。 */
function readLegacyToolCallKey(extra: unknown): string | null {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const record = extra as Record<string, unknown>;
  const rawCalls = record.tool_calls ?? record.toolCalls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null;
  const ids = rawCalls.map((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return null;
    const id = (call as Record<string, unknown>).id;
    return typeof id === "string" && id ? id : null;
  });
  return ids.every((id): id is string => id !== null) ? ids.join("\u0000") : null;
}
