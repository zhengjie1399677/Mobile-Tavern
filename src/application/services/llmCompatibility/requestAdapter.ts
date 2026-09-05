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
 * Preserved Thinking 适配：按相同或仅被请求包装的可见文本依次回填。
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

  const reasoningCandidates: ReasoningCandidate[] = sessionMessages.flatMap((message) => {
    if (message.sender !== "assistant" || !message.reasoningContent) return [];
    return [{
      content: message.content,
      reasoning: message.reasoningContent,
      toolCallKey: readLegacyToolCallKey(message.extra),
      used: false,
    }];
  });

  const byContent = new Map<string, CandidateEntry[]>();
  const byToolCallKey = new Map<string, CandidateEntry[]>();
  const emptyContentFallback: CandidateEntry[] = [];
  reasoningCandidates.forEach((candidate, index) => {
    const entry = { index, candidate };
    const contentList = byContent.get(candidate.content) ?? [];
    contentList.push(entry);
    byContent.set(candidate.content, contentList);
    if (candidate.toolCallKey) {
      const keyList = byToolCallKey.get(candidate.toolCallKey) ?? [];
      keyList.push(entry);
      byToolCallKey.set(candidate.toolCallKey, keyList);
    }
    if (candidate.content === "" && !candidate.toolCallKey) {
      emptyContentFallback.push(entry);
    }
  });

  const EMPTY_LIST: CandidateEntry[] = [];
  const pointers = new Map<CandidateEntry[], number>();
  const peekFirstUnused = (list: CandidateEntry[]): CandidateEntry | null => {
    let index = pointers.get(list) ?? 0;
    while (index < list.length && list[index].candidate.used) index += 1;
    pointers.set(list, index);
    return index < list.length ? list[index] : null;
  };
  const takeFrom = (list: CandidateEntry[]): string | null => {
    const entry = peekFirstUnused(list);
    if (!entry) return null;
    pointers.set(list, list.indexOf(entry) + 1);
    entry.candidate.used = true;
    return entry.candidate.reasoning;
  };
  /** 取两条按全局顺序各自有序的候选中最早未被消费的一个，保持原线性扫描语义。 */
  const takeFromEither = (
    primary: CandidateEntry[],
    fallback: CandidateEntry[],
  ): string | null => {
    const primaryEntry = peekFirstUnused(primary);
    const fallbackEntry = peekFirstUnused(fallback);
    const entry = primaryEntry && fallbackEntry
      ? primaryEntry.index <= fallbackEntry.index ? primaryEntry : fallbackEntry
      : primaryEntry ?? fallbackEntry;
    if (!entry) return null;
    pointers.set(
      entry === primaryEntry ? primary : fallback,
      (entry === primaryEntry ? primary : fallback).indexOf(entry) + 1,
    );
    entry.candidate.used = true;
    return entry.candidate.reasoning;
  };
  const takeWrappedContent = (providerContent: string): string | null => {
    const candidate = reasoningCandidates
      .filter((item) => !item.used && isRequestWrappedContent(providerContent, item.content))
      .sort((left, right) => right.content.trim().length - left.content.trim().length)[0];
    if (!candidate) return null;
    candidate.used = true;
    return candidate.reasoning;
  };

  return providerMessages.map((message) => {
    const cloned = cloneProviderMessage(message);
    if (cloned.role !== "assistant") return cloned;
    const toolCallKey = providerToolCallKey(cloned);
    const reasoning = typeof cloned.content === "string"
      ? takeFrom(byContent.get(cloned.content) ?? EMPTY_LIST) ?? takeWrappedContent(cloned.content)
      : cloned.content === null && toolCallKey !== null
        ? takeFromEither(byToolCallKey.get(toolCallKey) ?? EMPTY_LIST, emptyContentFallback)
        : null;
    if (reasoning === null) return cloned;
    return { ...cloned, reasoning_content: reasoning };
  });
}

interface ReasoningCandidate {
  content: string;
  reasoning: string;
  toolCallKey: string | null;
  used: boolean;
}

interface CandidateEntry {
  index: number;
  candidate: ReasoningCandidate;
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

/**
 * Prompt 编排可以在历史消息外增加角色包装、结构标签或开场消息补全。
 * 原始内容仍完整存在时视为同一条消息；不做模糊相似匹配，避免把思考内容错配给注入消息。
 */
function isRequestWrappedContent(providerContent: string, sessionContent: string): boolean {
  const normalizedProvider = providerContent.trim();
  const normalizedSession = sessionContent.trim();
  return normalizedSession.length > 0
    && normalizedProvider !== normalizedSession
    && normalizedProvider.includes(normalizedSession);
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
