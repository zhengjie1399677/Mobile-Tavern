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
  const tools = buildOpenAiToolDefinitions(options.tools);
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

    await options.context.recordDecision("tool.loop.step", {
      step,
      callIds: result.toolCalls.map((call) => call.callId),
      toolNames: result.toolCalls.map((call) => call.name),
    });
    continuationMessages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map(toOpenAiProviderToolCall),
    });
    for (const call of result.toolCalls) {
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
  return [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: structuredClone(tool.inputJsonSchema),
      },
    }));
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
