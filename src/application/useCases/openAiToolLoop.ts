import type {
  AgentToolCall,
  AgentToolDefinition,
  AgentTurnExecutionContext,
} from "../../domain/agents/contracts";
import type {
  OpenAiProviderMessage,
  OpenAiProviderToolCall,
} from "./multimodalProviderProjection";

export const MAX_AGENT_TOOL_STEPS = 8;
export const MAX_PROVIDER_FUNCTION_TOOLS = 128;
export const MAX_PROVIDER_FUNCTION_NAME_LENGTH = 64;

const PROVIDER_FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface OpenAiToolDefinitionPayload {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export interface OpenAiToolCallDelta {
  readonly index?: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

export interface OpenAiToolLoopModelStep {
  readonly step: number;
  readonly continuationMessages: readonly OpenAiProviderMessage[];
  readonly tools: readonly OpenAiToolDefinitionPayload[];
}

export interface OpenAiToolLoopModelResult {
  readonly content: string;
  readonly toolCalls: readonly AgentToolCall[];
}

export interface OpenAiToolLoopOptions {
  readonly context: AgentTurnExecutionContext;
  readonly tools: readonly AgentToolDefinition[];
  executeModelStep(step: OpenAiToolLoopModelStep): Promise<OpenAiToolLoopModelResult>;
  readonly maxSteps?: number;
}

/**
 * OpenAI-compatible 多步工具循环。
 *
 * 模型步骤由网络适配器执行，工具权限、Schema、超时和 Journal 仍统一经过 Agent Context。
 */
export async function executeOpenAiToolLoop(options: OpenAiToolLoopOptions): Promise<void> {
  const maxSteps = options.maxSteps ?? MAX_AGENT_TOOL_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new Error("AGENT_TOOL_LOOP_STEP_LIMIT_INVALID");
  }
  const transport = buildOpenAiToolTransport(options.tools);
  const tools = transport.definitions;
  const continuationMessages: OpenAiProviderMessage[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.context.signal.aborted) throw options.context.signal.reason;
    const result = await options.executeModelStep({
      step,
      continuationMessages: structuredClone(continuationMessages),
      tools,
    });
    if (result.toolCalls.length === 0) return;
    if (!options.context.provider.capabilities.supportsTools) {
      throw new Error(`AGENT_PROVIDER_TOOLS_UNSUPPORTED: ${options.context.providerId}`);
    }
    if (tools.length === 0) throw new Error("AGENT_TOOL_LOOP_NO_TOOLS_REGISTERED");

    const internalToolCalls = result.toolCalls.map((call) => ({
      ...call,
      name: transport.resolveInternalName(call.name),
    }));

    await options.context.recordDecision("tool.loop.step", {
      step,
      callIds: internalToolCalls.map((call) => call.callId),
      toolNames: internalToolCalls.map((call) => call.name),
    });
    // 没有后续模型步骤消费 Tool Result 时禁止执行工具，避免副作用成功而 Turn 仍失败。
    if (step === maxSteps - 1) {
      throw new Error(`AGENT_TOOL_LOOP_STEP_LIMIT_EXCEEDED: ${maxSteps}`);
    }
    continuationMessages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map(toOpenAiProviderToolCall),
    });
    for (const call of internalToolCalls) {
      const toolResult = await options.context.executeTool(call);
      continuationMessages.push({
        role: "tool",
        content: JSON.stringify(toolResult) ?? "null",
        tool_call_id: call.callId,
      });
    }
  }

  throw new Error(`AGENT_TOOL_LOOP_STEP_LIMIT_EXCEEDED: ${maxSteps}`);
}

export function buildOpenAiToolDefinitions(
  tools: readonly AgentToolDefinition[],
): OpenAiToolDefinitionPayload[] {
  return buildOpenAiToolTransport(tools).definitions;
}

function buildOpenAiToolTransport(tools: readonly AgentToolDefinition[]): {
  readonly definitions: OpenAiToolDefinitionPayload[];
  resolveInternalName(providerName: string): string;
} {
  if (tools.length > MAX_PROVIDER_FUNCTION_TOOLS) {
    throw new Error(`AGENT_PROVIDER_TOOL_LIMIT_EXCEEDED: ${tools.length}`);
  }
  const sortedTools = [...tools].sort((left, right) => left.name.localeCompare(right.name));
  const providerToInternal = new Map<string, string>();
  const definitions = sortedTools.map((tool) => {
    const providerName = createProviderFunctionName(tool.name, providerToInternal);
    providerToInternal.set(providerName, tool.name);
    return {
      type: "function" as const,
      function: {
        name: providerName,
        description: tool.description,
        parameters: structuredClone(tool.inputJsonSchema),
      },
    };
  });
  return {
    definitions,
    resolveInternalName(providerName: string): string {
      const internalName = providerToInternal.get(providerName);
      if (!internalName) throw new Error(`AGENT_PROVIDER_TOOL_NAME_UNMAPPED: ${providerName}`);
      return internalName;
    },
  };
}

function createProviderFunctionName(
  internalName: string,
  usedNames: ReadonlyMap<string, string>,
): string {
  if (PROVIDER_FUNCTION_NAME_PATTERN.test(internalName) && !usedNames.has(internalName)) {
    return internalName;
  }
  const normalized = internalName.replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  const hash = stableNameHash(internalName);
  for (let collisionIndex = 0; ; collisionIndex += 1) {
    const suffix = collisionIndex === 0 ? `_${hash}` : `_${hash}_${collisionIndex}`;
    const prefixLength = MAX_PROVIDER_FUNCTION_NAME_LENGTH - suffix.length;
    const candidate = `${normalized.slice(0, prefixLength) || "tool"}${suffix}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

function stableNameHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 聚合流式 delta.tool_calls，并在步骤结束时生成稳定 Tool Call。 */
export class OpenAiToolCallAccumulator {
  private readonly calls = new Map<number, {
    id: string;
    name: string;
    argumentsText: string;
  }>();

  append(deltas: readonly OpenAiToolCallDelta[] | undefined): void {
    for (const [fallbackIndex, delta] of (deltas ?? []).entries()) {
      const index = delta.index ?? fallbackIndex;
      const current = this.calls.get(index) ?? { id: "", name: "", argumentsText: "" };
      if (delta.id) current.id = delta.id;
      if (delta.function?.name) current.name += delta.function.name;
      if (delta.function?.arguments) current.argumentsText += delta.function.arguments;
      this.calls.set(index, current);
    }
  }

  finalize(): AgentToolCall[] {
    return [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => {
        if (!call.id.trim() || !call.name.trim()) {
          throw new Error(`AGENT_TOOL_CALL_INCOMPLETE: ${index}`);
        }
        let parsedArguments: unknown;
        try {
          parsedArguments = call.argumentsText.trim()
            ? JSON.parse(call.argumentsText) as unknown
            : {};
        } catch (error: unknown) {
          throw new Error(`AGENT_TOOL_ARGUMENTS_JSON_INVALID: ${call.id}`, { cause: error });
        }
        return {
          callId: call.id,
          name: call.name,
          arguments: parsedArguments,
        };
      });
  }
}

function toOpenAiProviderToolCall(call: AgentToolCall): OpenAiProviderToolCall {
  return {
    id: call.callId,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments) ?? "null",
    },
  };
}
