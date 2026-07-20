import type {
  PromptBlock,
  PromptComposition,
  PromptCompositionDiagnostic,
} from "./types";

const TEMPLATE_MACRO_REGEX = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

export interface PromptCompositionValidationOptions {
  availableDataKeys?: Iterable<string>;
}

export function collectPromptBlockDataKeys(block: PromptBlock): string[] {
  const keys: string[] = [];
  if (block.source.type === "chat_history") keys.push("chat.history");
  for (const match of block.template.matchAll(TEMPLATE_MACRO_REGEX)) {
    const key = match[1];
    if (key && !keys.includes(key)) keys.push(key);
  }
  if (block.condition?.dataKey && !keys.includes(block.condition.dataKey)) {
    keys.push(block.condition.dataKey);
  }
  return keys;
}

export function validatePromptComposition(
  composition: PromptComposition,
  options: PromptCompositionValidationOptions = {}
): PromptCompositionDiagnostic[] {
  const diagnostics: PromptCompositionDiagnostic[] = [];
  const available = options.availableDataKeys === undefined
    ? undefined
    : new Set(options.availableDataKeys);
  const seenIds = new Set<string>();
  const enabledHistoryIds = new Set(
    composition.blocks
      .filter((block) => block.enabled && block.source.type === "chat_history" && block.placement.type !== "in_chat")
      .map((block) => block.id)
  );

  for (const block of composition.blocks) {
    if (seenIds.has(block.id)) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_BLOCK_ID",
        message: `区块 ID 重复：${block.id}`,
        blockId: block.id,
      });
    } else {
      seenIds.add(block.id);
    }

    if (!block.enabled) continue;
    if (block.source.type === "template" && !block.template.trim()) {
      diagnostics.push({
        level: "error",
        code: "EMPTY_TEMPLATE",
        message: `区块“${block.name}”的模板为空。`,
        blockId: block.id,
      });
    }

    if (block.placement.type === "in_chat") {
      if (block.source.type === "chat_history") {
        diagnostics.push({
          level: "error",
          code: "NESTED_HISTORY_BLOCK",
          message: "聊天历史数据源不能作为历史深度注入内容。",
          blockId: block.id,
        });
      }
      const target = block.placement.historyBlockId;
      if ((target && !enabledHistoryIds.has(target)) || (!target && enabledHistoryIds.size === 0)) {
        diagnostics.push({
          level: "error",
          code: "INVALID_HISTORY_TARGET",
          message: target
            ? `历史深度目标不存在、未启用或并非聊天历史区块：${target}`
            : "历史深度注入没有可用的聊天历史目标。",
          blockId: block.id,
          detail: target,
        });
      }
    }

    if (available) {
      for (const key of collectPromptBlockDataKeys(block)) {
        if (key === "chat.history" || available.has(key)) continue;
        diagnostics.push({
          level: "error",
          code: "UNAVAILABLE_DATA_SOURCE",
          message: `区块“${block.name}”引用了不可用的数据源：${key}`,
          blockId: block.id,
          detail: key,
        });
      }
    }
  }

  return diagnostics;
}
