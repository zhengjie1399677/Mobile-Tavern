/**
 * 上下文来源注册表与并行读取（C0，暂不接线）。
 *
 * 读取语义（见设计文档 §3.2）：
 *   - 并行读取，按来源 id 稳定排序输出；
 *   - 单来源失败/超时只产出对应 status，不影响其它来源，也不让本轮发送失败；
 *   - 为每个已注册来源都产出贡献（含空占位），保证宏一定被解析为空字符串；
 *   - 不实现第二套预算：只做单来源字符上限。
 */
import {
  createContextSourceDefinition,
  type ContextContribution,
  type ContextContributionStatus,
  type ContextSourceDefinition,
  type ContextSourceRequest,
} from "../../domain/contextSources/contracts";

export interface ContextReadRequest {
  readonly sessionId: string;
  readonly userInput: string;
  /** 调用方（本轮发送）的取消信号；缺失时视为不可取消。 */
  readonly signal?: AbortSignal;
}

export interface ContextSourceRegistry {
  /** 注册来源；返回注销函数。重复 id 抛错，不做隐式覆盖。 */
  register(definition: ContextSourceDefinition): () => void;
  resolve(id: string): ContextSourceDefinition | undefined;
  /** 按 id 稳定排序的已注册来源。 */
  list(): readonly ContextSourceDefinition[];
  /** 并行读取全部已注册来源；永不抛出。 */
  readAll(request: ContextReadRequest): Promise<readonly ContextContribution[]>;
}

const NEVER_ABORT = new AbortController().signal;

interface ReadOutcome {
  readonly status: ContextContributionStatus;
  readonly content: string;
  readonly detail?: string;
}

async function readWithBudget(
  definition: ContextSourceDefinition,
  request: ContextSourceRequest,
): Promise<ReadOutcome> {
  if (request.signal.aborted) {
    return { status: "failed", content: "", detail: "aborted-before-read" };
  }
  const timeoutMarker = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof timeoutMarker>((resolve) => {
    timer = setTimeout(() => resolve(timeoutMarker), definition.timeoutMs);
  });
  // 先挂 catch，避免超时判负后源自身 reject 变成未处理拒绝。
  const read = definition
    .read(request)
    .then<ReadOutcome | typeof timeoutMarker>((value) => ({
      status: "ok",
      content: typeof value === "string" ? value : "",
    }))
    .catch<ReadOutcome | typeof timeoutMarker>((error: unknown) => ({
      status: "failed",
      content: "",
      detail: request.signal.aborted
        ? `aborted:${error instanceof Error ? error.message : String(error)}`
        : error instanceof Error
          ? error.message
          : String(error),
    }));
  try {
    const result = await Promise.race([read, timedOut]);
    if (result === timeoutMarker) {
      return { status: "timeout", content: "", detail: `timeout:${definition.timeoutMs}` };
    }
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function applyLimit(definition: ContextSourceDefinition, outcome: ReadOutcome): ContextContribution {
  if (outcome.status !== "ok") {
    return Object.freeze({
      sourceId: definition.id,
      macroName: definition.macroName,
      content: "",
      status: outcome.status,
      characters: 0,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    });
  }
  const content = outcome.content;
  if (content.trim().length === 0) {
    return Object.freeze({
      sourceId: definition.id,
      macroName: definition.macroName,
      content: "",
      status: "empty",
      characters: 0,
    });
  }
  if (content.length > definition.maxCharacters) {
    const truncated = content.slice(0, definition.maxCharacters);
    return Object.freeze({
      sourceId: definition.id,
      macroName: definition.macroName,
      content: truncated,
      status: "truncated",
      characters: truncated.length,
      detail: `truncated:${content.length}->${truncated.length}`,
    });
  }
  return Object.freeze({
    sourceId: definition.id,
    macroName: definition.macroName,
    content,
    status: "ok",
    characters: content.length,
  });
}

export function createContextSourceRegistry(): ContextSourceRegistry {
  const definitions = new Map<string, ContextSourceDefinition>();

  return {
    register(input) {
      const definition = createContextSourceDefinition(input);
      if (definitions.has(definition.id)) {
        throw new Error(`CONTEXT_SOURCE_ALREADY_REGISTERED:${definition.id}`);
      }
      definitions.set(definition.id, definition);
      return () => {
        if (definitions.get(definition.id) === definition) definitions.delete(definition.id);
      };
    },

    resolve(id) {
      return definitions.get(id);
    },

    list() {
      return [...definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
    },

    async readAll(request) {
      const signal = request.signal ?? NEVER_ABORT;
      const sourceRequest: ContextSourceRequest = {
        sessionId: request.sessionId,
        userInput: request.userInput,
        signal,
      };
      const ordered = [...definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
      const outcomes = await Promise.all(ordered.map((definition) => readWithBudget(definition, sourceRequest)));
      return Object.freeze(
        ordered.map((definition, index) => applyLimit(definition, outcomes[index])),
      );
    },
  };
}
