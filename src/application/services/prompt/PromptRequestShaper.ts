import type { PromptMessage, PromptMessageRole } from "../../../domain/prompt-composition";
import type { PromptRequestShapingConfig } from "../../../types";

export interface PromptRequestShapingReport {
  enabled: boolean;
  originalMessageCount: number;
  finalMessageCount: number;
  mergedMessageCount: number;
  squashedSystemMessageCount: number;
  assistantPrefillAdded: boolean;
  stopSequences: string[];
}

export interface ShapedPromptRequest {
  messages: PromptMessage[];
  stopSequences?: string[];
  report: PromptRequestShapingReport;
}

interface InChatPromptNode {
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * 将带有通用 in-chat metadata 的 Prompt Node 插入消息历史。
 * 该函数只处理 position/depth/role 机制，不解释任何来源格式。
 */
export function applyInChatPromptNodes(
  messages: ReadonlyArray<PromptMessage>,
  nodes: ReadonlyArray<InChatPromptNode>,
): PromptMessage[] {
  const injections = nodes.flatMap((node, index) => {
    const metadata = node.metadata;
    if (metadata?.position !== "in_chat" || !node.content.trim()) return [];
    const rawDepth = metadata.depth;
    const depth = typeof rawDepth === "number" && Number.isFinite(rawDepth)
      ? Math.max(0, Math.floor(rawDepth))
      : 0;
    const rawRole = metadata.role;
    const role: PromptMessageRole = rawRole === "assistant" || rawRole === "user"
      ? rawRole
      : "system";
    const rawOrder = metadata.order;
    const order = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : 100;
    const rawName = metadata.name;
    const name = typeof rawName === "string" && rawName ? rawName : undefined;
    return [{ node: { role, name, content: node.content }, depth, order, index }];
  });
  if (injections.length === 0) return messages.map((message) => ({ ...message }));

  const baseLength = messages.length;
  const grouped = new Map<number, typeof injections>();
  for (const injection of injections) {
    const target = Math.max(1, baseLength - injection.depth);
    const group = grouped.get(target) ?? [];
    group.push(injection);
    grouped.set(target, group);
  }

  const result = messages.map((message) => ({ ...message }));
  for (const [target, group] of [...grouped.entries()].sort(([left], [right]) => right - left)) {
    group.sort((left, right) => left.order - right.order || left.index - right.index);
    result.splice(target, 0, ...group.map(({ node }) => node));
  }
  return result;
}

export function buildPromptRequestMessages(
  systemInstruction: string,
  history: ReadonlyArray<{
    role: "model" | "user" | "assistant";
    name?: string;
    content: string;
  }>,
  sendNames: boolean | undefined,
): PromptMessage[] {
  return [
    { role: "system", content: systemInstruction },
    ...history.map((message) => ({
      role: message.role === "model" ? "assistant" as const : message.role,
      name: sendNames ? message.name : undefined,
      content: message.content,
    })),
  ];
}

/** 对最终模型消息执行可预览、无副作用的通用请求整形。 */
export function shapePromptRequest(
  input: ReadonlyArray<PromptMessage>,
  config?: PromptRequestShapingConfig,
): ShapedPromptRequest {
  const originalMessageCount = input.length;
  if (!config?.enabled) {
    return {
      messages: input.map(cloneMessage),
      report: emptyReport(originalMessageCount),
    };
  }

  let messages = input.map((message) => applyRoleWrapper(message, config));
  let squashedSystemMessageCount = 0;
  if (config.squashSystemMessages) {
    const result = squashSystemMessages(messages);
    messages = result.messages;
    squashedSystemMessageCount = result.squashedCount;
  }

  let mergedMessageCount = 0;
  if (config.mergeAdjacentMessages) {
    const result = mergeAdjacentMessages(messages);
    messages = result.messages;
    mergedMessageCount = result.mergedCount;
  }

  const assistantPrefill = normalizeText(config.assistantPrefill);
  if (assistantPrefill) {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.name === undefined) {
      last.content = `${last.content}${assistantPrefill}`;
    } else {
      messages.push({ role: "assistant", content: assistantPrefill });
    }
  }

  const stopSequences = normalizeStopSequences(config.stopSequences);
  return {
    messages,
    stopSequences: stopSequences.length > 0 ? stopSequences : undefined,
    report: {
      enabled: true,
      originalMessageCount,
      finalMessageCount: messages.length,
      mergedMessageCount,
      squashedSystemMessageCount,
      assistantPrefillAdded: !!assistantPrefill,
      stopSequences,
    },
  };
}

function cloneMessage(message: PromptMessage): PromptMessage {
  return { ...message };
}

function emptyReport(messageCount: number): PromptRequestShapingReport {
  return {
    enabled: false,
    originalMessageCount: messageCount,
    finalMessageCount: messageCount,
    mergedMessageCount: 0,
    squashedSystemMessageCount: 0,
    assistantPrefillAdded: false,
    stopSequences: [],
  };
}

function applyRoleWrapper(
  message: PromptMessage,
  config: PromptRequestShapingConfig,
): PromptMessage {
  const wrapper = config.roleWrappers?.[message.role];
  return {
    ...message,
    content: `${wrapper?.prefix ?? ""}${message.content}${wrapper?.suffix ?? ""}`,
  };
}

function squashSystemMessages(messages: PromptMessage[]): {
  messages: PromptMessage[];
  squashedCount: number;
} {
  const systemMessages = messages.filter((message) => message.role === "system");
  if (systemMessages.length <= 1) return { messages, squashedCount: 0 };

  const firstSystemIndex = messages.findIndex((message) => message.role === "system");
  const squashed: PromptMessage = {
    role: "system",
    content: systemMessages.map((message) => message.content).join("\n\n"),
  };
  const firstName = systemMessages[0]?.name;
  if (firstName && systemMessages.every((message) => message.name === firstName)) {
    squashed.name = firstName;
  }
  const remaining = messages.filter((message) => message.role !== "system");
  remaining.splice(firstSystemIndex, 0, squashed);
  return { messages: remaining, squashedCount: systemMessages.length - 1 };
}

function mergeAdjacentMessages(messages: PromptMessage[]): {
  messages: PromptMessage[];
  mergedCount: number;
} {
  const merged: PromptMessage[] = [];
  let mergedCount = 0;
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role && previous.name === message.name) {
      previous.content = `${previous.content}\n\n${message.content}`;
      mergedCount++;
    } else {
      merged.push({ ...message });
    }
  }
  return { messages: merged, mergedCount };
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeStopSequences(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].slice(0, 16);
}
