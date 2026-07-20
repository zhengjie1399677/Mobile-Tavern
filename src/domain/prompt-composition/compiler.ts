import type {
  CompiledPromptComposition,
  PromptBlock,
  PromptComposition,
  PromptCompositionCompileOptions,
  PromptCompositionDiagnostic,
  PromptCompositionRuntimeData,
  PromptCompositionTrace,
  PromptMessage,
} from "./types";
import { collectPromptBlockDataKeys, validatePromptComposition } from "./validator";

const TEMPLATE_MACRO_REGEX = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

interface RenderResult {
  content: string;
  diagnostics: PromptCompositionDiagnostic[];
}

interface CompiledMessage {
  message: PromptMessage;
  blockId: string;
}

/**
 * 唯一的中立 Prompt 编译器。
 * 仅理解消息、顺序、历史深度、字符串数据源和显式 Token 策略，
 * 不解释角色卡、世界书或任何外部格式的业务语义。
 */
export function compilePromptComposition(
  composition: PromptComposition,
  runtime: PromptCompositionRuntimeData,
  options: PromptCompositionCompileOptions = {}
): CompiledPromptComposition {
  const diagnostics = validatePromptComposition(composition, {
    availableDataKeys: Object.keys(runtime.values),
  });
  const compiledMessages: CompiledMessage[] = [];
  const seenIds = new Set<string>();
  const uniqueBlocks = composition.blocks.filter((block) => {
    if (seenIds.has(block.id)) return false;
    seenIds.add(block.id);
    return true;
  });
  const traceBlocks = uniqueBlocks.filter((block) => block.enabled);
  const blocks = uniqueBlocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.enabled && matchesCondition(block, runtime.values))
    .sort((left, right) => left.block.order - right.block.order || left.index - right.index);

  const inChatBlocks = blocks.filter(({ block }) => block.placement.type === "in_chat");
  const expandedHistoryBlockIds = new Set<string>();

  for (const { block } of blocks) {
    if (block.placement.type === "in_chat") continue;

    if (block.source.type === "chat_history") {
      const history = selectHistory(runtime.history, block).map((message) => ({
        message,
        blockId: block.id,
      }));
      const injections = inChatBlocks
        .map(({ block: injection }) => injection)
        .filter((injection) => injection.placement.type === "in_chat" &&
          (!injection.placement.historyBlockId || injection.placement.historyBlockId === block.id));
      injectIntoHistory(history, injections, runtime, diagnostics);
      expandedHistoryBlockIds.add(block.id);
      compiledMessages.push(...history);
      continue;
    }

    const rendered = renderTemplate(block, runtime.values);
    diagnostics.push(...rendered.diagnostics);
    if (rendered.content.trim()) {
      compiledMessages.push({
        message: { role: block.role, content: rendered.content.trim() },
        blockId: block.id,
      });
    }
  }

  for (const { block } of inChatBlocks) {
    if (block.placement.type !== "in_chat") continue;
    const target = block.placement.historyBlockId;
    const hasStaticTargetError = diagnostics.some((diagnostic) =>
      diagnostic.code === "INVALID_HISTORY_TARGET" && diagnostic.blockId === block.id);
    if (!hasStaticTargetError &&
      ((target && !expandedHistoryBlockIds.has(target)) || (!target && expandedHistoryBlockIds.size === 0))) {
      diagnostics.push({
        level: "warning",
        code: "MISSING_HISTORY_BLOCK",
        message: target
          ? `历史深度注入目标在本次编译中不可用：${target}`
          : "存在历史深度注入区块，但本次编译没有可用的聊天历史数据源。",
        blockId: block.id,
      });
    }
  }

  const estimateTokens = options.estimateTokens ?? defaultEstimateTokens;
  const originalTokensByBlock = sumTokensByBlock(compiledMessages, estimateTokens);
  const originalUsed = sumTokens(compiledMessages, estimateTokens);
  const droppedBlockIds: string[] = [];
  let finalMessages = compiledMessages;

  if (isPositiveFinite(options.tokenBudget) && originalUsed > options.tokenBudget) {
    let used = originalUsed;
    const droppable = blocks
      .map(({ block, index }) => ({ block, index }))
      .filter(({ block }) => block.tokenPolicy?.overflow === "drop" &&
        (originalTokensByBlock.get(block.id) ?? 0) > 0)
      .sort((left, right) =>
        (left.block.tokenPolicy?.priority ?? 50) - (right.block.tokenPolicy?.priority ?? 50) ||
        left.index - right.index);

    for (const { block } of droppable) {
      if (used <= options.tokenBudget) break;
      const blockTokens = originalTokensByBlock.get(block.id) ?? 0;
      used -= blockTokens;
      droppedBlockIds.push(block.id);
      diagnostics.push({
        level: "warning",
        code: "TOKEN_BUDGET_DROPPED_BLOCK",
        message: `Token 预算不足，已裁剪区块“${block.name}”（约 ${blockTokens} Token）。`,
        blockId: block.id,
      });
    }

    if (droppedBlockIds.length > 0) {
      const dropped = new Set(droppedBlockIds);
      finalMessages = compiledMessages.filter((item) => !dropped.has(item.blockId));
    }
    if (used > options.tokenBudget) {
      diagnostics.push({
        level: "error",
        code: "TOKEN_BUDGET_EXCEEDED",
        message: `不可裁剪内容仍超出 Token 预算：约 ${used} / ${options.tokenBudget} Token。`,
      });
    }
  }

  const messages = finalMessages.map((item) => item.message);
  const droppedSet = new Set(droppedBlockIds);
  const traces = buildTraces(
    traceBlocks,
    finalMessages,
    runtime,
    originalTokensByBlock,
    droppedSet
  );
  const budget = isPositiveFinite(options.tokenBudget)
    ? {
        limit: options.tokenBudget,
        used: sumTokens(finalMessages, estimateTokens),
        originalUsed,
        droppedBlockIds,
      }
    : undefined;

  return { messages, diagnostics, traces, budget };
}

function selectHistory(history: PromptMessage[], block: PromptBlock): PromptMessage[] {
  if (block.source.type !== "chat_history" || !block.source.selection || block.source.selection.mode === "all") {
    return history.map((message) => ({ ...message }));
  }
  const count = Math.max(0, Math.floor(block.source.selection.count));
  if (count === 0) return [];
  if (history.length <= count) return history.map((message) => ({ ...message }));
  const first = history[0];
  if (block.source.selection.preserveFirstAssistant && first?.role === "assistant") {
    return count === 1
      ? [{ ...first }]
      : [{ ...first }, ...history.slice(-(count - 1)).map((message) => ({ ...message }))];
  }
  return history.slice(-count).map((message) => ({ ...message }));
}

function injectIntoHistory(
  history: CompiledMessage[],
  blocks: PromptBlock[],
  runtime: PromptCompositionRuntimeData,
  diagnostics: PromptCompositionDiagnostic[]
): void {
  const rendered = blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => {
      const leftPlacement = left.block.placement.type === "in_chat" ? left.block.placement : null;
      const rightPlacement = right.block.placement.type === "in_chat" ? right.block.placement : null;
      const depthDiff = (rightPlacement?.depth ?? 0) - (leftPlacement?.depth ?? 0);
      if (depthDiff !== 0) return depthDiff;
      return (leftPlacement?.order ?? left.block.order) - (rightPlacement?.order ?? right.block.order) || left.index - right.index;
    });

  for (const { block } of rendered) {
    if (block.source.type === "chat_history") continue;
    const result = renderTemplate(block, runtime.values);
    diagnostics.push(...result.diagnostics);
    if (!result.content.trim()) continue;
    const depth = block.placement.type === "in_chat"
      ? Math.max(0, Math.floor(block.placement.depth))
      : 0;
    const insertionIndex = Math.max(0, history.length - depth);
    history.splice(insertionIndex, 0, {
      message: { role: block.role, content: result.content.trim() },
      blockId: block.id,
    });
  }
}

function renderTemplate(block: PromptBlock, values: Record<string, string>): RenderResult {
  const diagnostics: PromptCompositionDiagnostic[] = [];
  const content = block.template.replace(TEMPLATE_MACRO_REGEX, (fullMatch, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key] ?? "";
    diagnostics.push({
      level: "warning",
      code: "UNKNOWN_MACRO",
      message: `区块引用了未注册的数据源宏：${key}`,
      blockId: block.id,
      detail: key,
    });
    return fullMatch;
  });
  return { content, diagnostics };
}

function matchesCondition(block: PromptBlock, values: Record<string, string>): boolean {
  if (!block.condition) return true;
  const current = values[block.condition.dataKey] ?? "";
  if (block.condition.operator === "not_empty") return current.trim().length > 0;
  if (block.condition.operator === "empty") return current.trim().length === 0;
  if (block.condition.operator === "equals") return current === (block.condition.value ?? "");
  return current !== (block.condition.value ?? "");
}

function buildTraces(
  blocks: PromptBlock[],
  messages: CompiledMessage[],
  runtime: PromptCompositionRuntimeData,
  originalTokensByBlock: Map<string, number>,
  droppedBlockIds: Set<string>
): PromptCompositionTrace[] {
  return blocks.map((block) => {
    const dataKeys = collectPromptBlockDataKeys(block);
    const messageIndexes: number[] = [];
    let renderedCharacters = 0;
    messages.forEach((item, index) => {
      if (item.blockId !== block.id) return;
      messageIndexes.push(index);
      renderedCharacters += item.message.content.length;
    });
    return {
      blockId: block.id,
      blockName: block.name,
      sourceType: block.source.type,
      dataKeys,
      resolvedDataKeys: dataKeys.filter((key) =>
        key === "chat.history" || Object.prototype.hasOwnProperty.call(runtime.values, key)),
      missingDataKeys: dataKeys.filter((key) =>
        key !== "chat.history" && !Object.prototype.hasOwnProperty.call(runtime.values, key)),
      messageIndexes,
      renderedCharacters,
      estimatedTokens: originalTokensByBlock.get(block.id) ?? 0,
      dropped: droppedBlockIds.has(block.id),
    };
  });
}

function sumTokensByBlock(
  messages: CompiledMessage[],
  estimateTokens: (text: string) => number
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of messages) {
    totals.set(item.blockId, (totals.get(item.blockId) ?? 0) + normalizeTokenEstimate(estimateTokens(item.message.content)));
  }
  return totals;
}

function sumTokens(messages: CompiledMessage[], estimateTokens: (text: string) => number): number {
  return messages.reduce(
    (total, item) => total + normalizeTokenEstimate(estimateTokens(item.message.content)),
    0
  );
}

function normalizeTokenEstimate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
