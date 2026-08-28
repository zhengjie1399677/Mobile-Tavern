import type { StreamChunk } from "../../serviceContracts";

type UnknownRecord = Record<string, unknown>;
type NormalizedToolCall = NonNullable<
  NonNullable<NonNullable<StreamChunk["choices"]>[number]["delta"]>["tool_calls"]
>[number];

/** 把 OpenAI 兼容、中转站别名、Anthropic SSE 与 Gemini candidates 归一为内部 StreamChunk。 */
export function normalizeProviderStreamChunk(input: unknown): StreamChunk | null {
  if (!isRecord(input)) return null;
  if (Array.isArray(input.choices)) return normalizeChoicesChunk(input);
  if (isRecord(input.output) && Array.isArray(input.output.choices)) {
    return normalizeChoicesChunk({ ...input, choices: input.output.choices });
  }
  if (Array.isArray(input.candidates)) return normalizeGeminiChunk(input);
  if (typeof input.type === "string") {
    const anthropic = normalizeAnthropicChunk(input);
    if (anthropic) return anthropic;
  }
  return normalizeTopLevelChunk(input);
}

function normalizeChoicesChunk(input: UnknownRecord): StreamChunk {
  const choices = (input.choices as unknown[]).map((choice, choiceIndex) => {
    if (!isRecord(choice)) return { index: choiceIndex };
    const rawDelta = isRecord(choice.delta)
      ? choice.delta
      : isRecord(choice.message)
        ? choice.message
        : {};
    const delta = normalizeMessageDelta(rawDelta);
    return {
      index: readNumber(choice.index) ?? choiceIndex,
      delta,
      message: isRecord(choice.message) ? normalizeMessageDelta(choice.message) : undefined,
      text: readText(choice.text),
      finish_reason: normalizeFinishReason(choice.finish_reason ?? choice.finishReason),
    };
  });
  return {
    choices,
    usage: normalizeUsage(input.usage),
    error: normalizeError(input.error),
    __rescuedContent: readText(input.__rescuedContent),
  };
}

function normalizeTopLevelChunk(input: UnknownRecord): StreamChunk | null {
  const content = readText(input.content ?? input.text ?? input.result);
  const reasoning = readText(
    input.reasoning_content ?? input.reasoningContent ?? input.reasoning ?? input.thinking,
  );
  const toolCalls = normalizeToolCalls(input.tool_calls ?? input.toolCalls);
  const error = normalizeError(input.error);
  if (!content && !reasoning && !toolCalls && !error && !input.usage) return null;
  return {
    choices: [{
      delta: {
        content,
        reasoning_content: reasoning,
        tool_calls: toolCalls,
      },
      finish_reason: normalizeFinishReason(input.finish_reason ?? input.finishReason),
    }],
    usage: normalizeUsage(input.usage),
    error,
  };
}

function normalizeAnthropicChunk(input: UnknownRecord): StreamChunk | null {
  const type = input.type;
  if (type === "content_block_start" && isRecord(input.content_block)) {
    const block = input.content_block;
    if (block.type === "tool_use") {
      return toolCallChunk(input.index, block.id, block.name, JSON.stringify(block.input ?? {}));
    }
  }
  if (type === "content_block_delta" && isRecord(input.delta)) {
    const delta = input.delta;
    if (delta.type === "input_json_delta") {
      return toolCallChunk(input.index, undefined, undefined, readText(delta.partial_json));
    }
    const reasoning = delta.type === "thinking_delta"
      ? readText(delta.thinking)
      : undefined;
    const content = delta.type === "text_delta" ? readText(delta.text) : undefined;
    return {
      choices: [{ delta: { content, reasoning_content: reasoning } }],
    };
  }
  if (type === "message_delta" && isRecord(input.delta)) {
    return {
      choices: [{ finish_reason: normalizeFinishReason(input.delta.stop_reason) }],
      usage: normalizeUsage(input.usage),
    };
  }
  if (type === "error") return { error: normalizeError(input.error) ?? "Anthropic stream error" };
  return null;
}

function normalizeGeminiChunk(input: UnknownRecord): StreamChunk | null {
  const candidate = (input.candidates as unknown[]).find(isRecord);
  if (!candidate) return null;
  const parts = isRecord(candidate.content) && Array.isArray(candidate.content.parts)
    ? candidate.content.parts.filter(isRecord)
    : [];
  const content = parts.filter((part) => part.thought !== true).map((part) => readText(part.text) ?? "").join("");
  const reasoning = parts.filter((part) => part.thought === true).map((part) => readText(part.text) ?? "").join("");
  return {
    choices: [{
      delta: {
        content: content || undefined,
        reasoning_content: reasoning || undefined,
      },
      finish_reason: normalizeFinishReason(candidate.finishReason),
    }],
    usage: normalizeUsage(input.usageMetadata),
  };
}

function normalizeMessageDelta(input: UnknownRecord) {
  return {
    content: readText(input.content ?? input.text),
    reasoning_content: readText(
      input.reasoning_content ?? input.reasoningContent ?? input.reasoning ?? input.thinking,
    ),
    tool_calls: normalizeToolCalls(input.tool_calls ?? input.toolCalls),
  };
}

function normalizeToolCalls(input: unknown): NormalizedToolCall[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const fn = isRecord(item.function) ? item.function : item;
    return [{
      index: readNumber(item.index) ?? index,
      id: readText(item.id),
      type: readText(item.type) ?? "function",
      function: {
        name: readText(fn.name),
        arguments: readText(fn.arguments ?? fn.arguments_json),
      },
    }];
  });
}

function toolCallChunk(index: unknown, id: unknown, name: unknown, args: string | undefined): StreamChunk {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index: readNumber(index) ?? 0,
          id: readText(id),
          type: "function",
          function: { name: readText(name), arguments: args },
        }],
      },
    }],
  };
}

function normalizeUsage(input: unknown): StreamChunk["usage"] {
  if (!isRecord(input)) return undefined;
  const prompt = readNumber(input.prompt_tokens ?? input.input_tokens ?? input.promptTokenCount);
  const completion = readNumber(input.completion_tokens ?? input.output_tokens ?? input.candidatesTokenCount);
  if (prompt === undefined && completion === undefined) return undefined;
  return { prompt_tokens: prompt ?? 0, completion_tokens: completion ?? 0 };
}

function normalizeFinishReason(input: unknown): string | undefined {
  const value = readText(input)?.toLowerCase();
  if (!value) return undefined;
  if (["safety", "recitation", "prohibited_content", "sensitive"].includes(value)) return "content_filter";
  if (["max_tokens", "max_token", "model_context_window_exceeded"].includes(value)) return "length";
  if (value === "tool_use" || value === "function_call") return "tool_calls";
  return value;
}

function normalizeError(input: unknown): StreamChunk["error"] {
  if (typeof input === "string") return input;
  if (!isRecord(input)) return undefined;
  return { message: readText(input.message ?? input.detail ?? input.error) };
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
