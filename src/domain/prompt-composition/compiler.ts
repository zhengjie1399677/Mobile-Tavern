import type {
  CompiledPromptComposition,
  PromptBlock,
  PromptComposition,
  PromptCompositionDiagnostic,
  PromptCompositionRuntimeData,
  PromptMessage,
} from "./types";

const TEMPLATE_MACRO_REGEX = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

interface RenderResult {
  content: string;
  diagnostics: PromptCompositionDiagnostic[];
}

/**
 * 唯一的中立 Prompt 编译器。
 *
 * 它只理解消息角色、数组顺序、历史插入深度和字符串数据源，不理解角色卡、
 * 世界书或任何外部格式的专有概念。相邻同角色消息不会被合并。
 */
export function compilePromptComposition(
  composition: PromptComposition,
  runtime: PromptCompositionRuntimeData
): CompiledPromptComposition {
  const diagnostics: PromptCompositionDiagnostic[] = [];
  const messages: PromptMessage[] = [];
  const blocks = composition.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.enabled && matchesCondition(block, runtime.values))
    .sort((left, right) => left.block.order - right.block.order || left.index - right.index);

  const inChatBlocks = blocks.filter(({ block }) => block.placement.type === "in_chat");
  const expandedHistoryBlockIds = new Set<string>();

  for (const { block } of blocks) {
    if (block.placement.type === "in_chat") continue;

    if (block.source.type === "chat_history") {
      const history = selectHistory(runtime.history, block);
      const injections = inChatBlocks
        .map(({ block: injection }) => injection)
        .filter((injection) => injection.placement.type === "in_chat" &&
          (!injection.placement.historyBlockId || injection.placement.historyBlockId === block.id));
      injectIntoHistory(history, injections, runtime, diagnostics);
      expandedHistoryBlockIds.add(block.id);
      messages.push(...history);
      continue;
    }

    const rendered = renderTemplate(block, runtime.values);
    diagnostics.push(...rendered.diagnostics);
    if (rendered.content.trim()) {
      messages.push({ role: block.role, content: rendered.content.trim() });
    }
  }

  for (const { block } of inChatBlocks) {
    if (block.placement.type !== "in_chat") continue;
    const target = block.placement.historyBlockId;
    if ((target && !expandedHistoryBlockIds.has(target)) || (!target && expandedHistoryBlockIds.size === 0)) {
      diagnostics.push({
        level: "warning",
        code: "MISSING_HISTORY_BLOCK",
        message: target
          ? `历史深度注入目标不存在或未启用：${target}`
          : "存在历史深度注入区块，但编排中没有启用聊天历史数据源。",
        blockId: block.id,
      });
    }
  }

  return { messages, diagnostics };
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
  history: PromptMessage[],
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
    if (block.source.type === "chat_history") {
      diagnostics.push({
        level: "warning",
        code: "NESTED_HISTORY_BLOCK",
        message: "聊天历史数据源不能作为历史深度注入内容，已跳过。",
        blockId: block.id,
      });
      continue;
    }
    const result = renderTemplate(block, runtime.values);
    diagnostics.push(...result.diagnostics);
    if (!result.content.trim()) continue;
    const depth = block.placement.type === "in_chat"
      ? Math.max(0, Math.floor(block.placement.depth))
      : 0;
    const insertionIndex = Math.max(0, history.length - depth);
    history.splice(insertionIndex, 0, { role: block.role, content: result.content.trim() });
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
