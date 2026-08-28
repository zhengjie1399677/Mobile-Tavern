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

  const reasoningQueues = new Map<string, string[]>();
  for (const message of sessionMessages) {
    if (message.sender !== "assistant" || !message.reasoningContent) continue;
    const queue = reasoningQueues.get(message.content) ?? [];
    queue.push(message.reasoningContent);
    reasoningQueues.set(message.content, queue);
  }

  return providerMessages.map((message) => {
    const cloned = cloneProviderMessage(message);
    if (cloned.role !== "assistant" || typeof cloned.content !== "string") return cloned;
    const queue = reasoningQueues.get(cloned.content);
    const reasoning = queue?.shift();
    return reasoning ? { ...cloned, reasoning_content: reasoning } : cloned;
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
