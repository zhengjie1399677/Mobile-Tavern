import type { PromptMessage, PromptMessageRole } from "../../../domain/prompts/promptAssemblyTypes";
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
  namesBehavior?: -1 | 0 | 1 | 2,
): PromptMessage[] {
  // SillyTavern names_behavior：1 = 通过消息 name 字段携带；2 = 直接写进内容；
  // -1/0 在单聊中都不加名；未声明时沿用本应用既有的 sendNames 开关。
  const includeNameField = namesBehavior === 1
    ? true
    : namesBehavior === undefined ? sendNames : false;
  const prefixNameInContent = namesBehavior === 2;
  return [
    { role: "system", content: systemInstruction },
    ...history.map((message) => ({
      role: message.role === "model" ? "assistant" as const : message.role,
      name: includeNameField ? message.name : undefined,
      content: prefixNameInContent && message.name
        ? `${message.name}: ${message.content}`
        : message.content,
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

  messages = applyCustomPromptPostProcessing(messages, config.customPromptPostProcessing);

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

/**
 * SillyTavern `custom_prompt_post_processing` 的通用部分。
 *
 * 只实现与 Chat Completions 消息角色有关的语义：`semi` / `strict` 把首条之后的
 * system 消息降级为 user，`single` 把所有消息压成 user。`strict` 的占位消息属于
 * 生态行为引导，不在通用代码里硬编码（`COMPAT-DATA`）。
 */
function applyCustomPromptPostProcessing(
  messages: PromptMessage[],
  mode: string | undefined,
): PromptMessage[] {
  const normalized = mode?.toLowerCase();
  if (!normalized || normalized === "none" || normalized === "" || normalized === "claude" || normalized === "merge") {
    return messages;
  }
  if (normalized === "single") {
    return messages.map((message) => ({
      role: "user" as const,
      content: message.name ? `${message.name}: ${message.content}` : message.content,
    }));
  }
  const strict = normalized === "semi"
    || normalized === "semi_tools"
    || normalized === "strict"
    || normalized === "strict_tools";
  if (!strict) return messages;
  return messages.map((message, index) => (
    index > 0 && message.role === "system"
      ? { ...message, role: "user" as const }
      : message
  ));
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
