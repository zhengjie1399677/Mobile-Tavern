import type {
  PromptBlock,
  PromptComposition,
  PromptCompositionDiagnostic,
} from "./types";

const TEMPLATE_MACRO_REGEX = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

const ALLOWED_MACRO_NAMESPACES = [
  "getvar::",
  "setvar::",
  "getglobalvar::",
  "setglobalvar::",
  "var::",
  "globalvar::",
  "char::",
  "user::",
  "persona::",
  "world::",
  "lore::",
  "lorebook::",
  "st::",
  "tavern::",
  "macro::",
  "regex::",
];

const KNOWN_BUILTIN_MACROS = new Set([
  "char",
  "user",
  "char_name",
  "user_name",
  "char_version",
  "char_prompt",
  "char_persona",
  "description",
  "persona",
  "personality",
  "scenario",
  "mesexamples",
  "system",
  "post_history_instructions",
  "wibefore",
  "wiafter",
  "input",
  "lastmessage",
  "lastmessageid",
  "lastusermessage",
  "lastcharmessage",
  "idle_duration",
  "trim",
  "date",
  "time",
  "datetime",
  "model",
  "guid",
  "random",
  "noop",
  "newline",
]);

function isRecognizedMacroKey(key: string, available: Set<string>): boolean {
  if (key === "chat.history" || available.has(key)) return true;
  if (key.startsWith("//")) return true;
  const lowerKey = key.toLowerCase();
  if (KNOWN_BUILTIN_MACROS.has(lowerKey)) return true;
  if (ALLOWED_MACRO_NAMESPACES.some((prefix) => lowerKey.startsWith(prefix))) return true;
  return false;
}

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
  const sceneProfileIds = new Set<string>();
  const enabledHistoryIds = new Set(
    composition.blocks
      .filter((block) => block.enabled && block.source.type === "chat_history" && block.placement.type !== "in_chat")
      .map((block) => block.id)
  );

  for (const profile of composition.sceneProfiles ?? []) {
    if (sceneProfileIds.has(profile.id)) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_SCENE_PROFILE_ID",
        message: `场景方案 ID 重复：${profile.id}`,
      });
    }
    sceneProfileIds.add(profile.id);
    for (const blockId of Object.keys(profile.blockStates)) {
      if (composition.blocks.some((block) => block.id === blockId)) continue;
      diagnostics.push({
        level: "warning",
        code: "SCENE_PROFILE_UNKNOWN_BLOCK",
        message: `场景方案“${profile.name}”引用了不存在的区块：${blockId}`,
        detail: blockId,
      });
    }
  }

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
        if (isRecognizedMacroKey(key, available)) continue;
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
