import type { PromptBlock, PromptComposition } from "./types";

export type PromptCompositionScenePresetId =
  | "lightweight_chat"
  | "long_chat_budget"
  | "worldbook_priority"
  | "memory_enhanced"
  | "character_card_compatible";

export interface PromptCompositionScenePreset {
  id: PromptCompositionScenePresetId;
  name: string;
  description: string;
  composition: PromptComposition;
}

const PRESETS: readonly PromptCompositionScenePreset[] = [
  preset("lightweight_chat", "轻量对话", "保留角色核心资料与最近对话，适合低上下文开销。", [
    template("light_main", "主 Prompt", "{{prompt.main}}", 100),
    template("light_character", "角色核心资料", "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}", 200),
    history("light_history", "最近聊天历史", 300, 8),
  ]),
  preset("long_chat_budget", "长对话省 Token", "优先保留最近历史，资料区块可按优先级裁剪。", [
    template("long_main", "主 Prompt", "{{prompt.main}}", 100),
    droppable(template("long_character", "角色资料", "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}", 200), 60),
    droppable(template("long_worldbook", "触发世界书", "{{worldbook.triggered}}", 300), 30),
    droppable(template("long_memory", "长期记忆", "{{memory.summaries}}\n\n{{memory.recalled}}", 400), 20),
    history("long_history", "最近聊天历史", 500, 12),
  ], { enabled: true, mode: "model" }),
  preset("worldbook_priority", "世界书优先", "分别保留角色定义前后的已触发世界书数据。", [
    template("world_before", "角色定义前世界书", "{{worldbook.before}}", 100),
    template("world_character", "角色卡资料", "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}", 200),
    template("world_after", "角色定义后世界书", "{{worldbook.after}}", 300),
    history("world_history", "聊天历史", 400, 10),
  ]),
  preset("memory_enhanced", "长期记忆增强", "将摘要、召回记忆和表格记忆拆分，方便独立排序与裁剪。", [
    template("memory_main", "主 Prompt", "{{prompt.main}}", 100),
    template("memory_character", "角色卡资料", "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}", 200),
    droppable(template("memory_summaries", "对话摘要", "{{memory.summaries}}", 300), 30),
    droppable(template("memory_recalled", "召回记忆", "{{memory.recalled}}", 400), 40),
    droppable(template("memory_tables", "表格记忆", "{{memory.tables}}", 500), 50),
    history("memory_history", "最近聊天历史", 600, 8),
  ]),
  preset("character_card_compatible", "角色卡原味兼容", "按角色卡资料、示例对话、历史与后置 Prompt 组织现有数据。", [
    template("card_main", "主 Prompt", "{{prompt.main}}", 100),
    template("card_character", "角色卡资料", "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}", 200),
    template("card_examples", "示例对话", "{{character.examples}}", 300),
    template("card_worldbook", "触发世界书", "{{worldbook.triggered}}", 400),
    history("card_history", "聊天历史", 500),
    template("card_post", "历史后 Prompt", "{{prompt.postHistory}}", 600),
  ]),
];

export function listPromptCompositionScenePresets(): PromptCompositionScenePreset[] {
  return PRESETS.map((preset) => structuredClone(preset));
}

function preset(
  id: PromptCompositionScenePresetId,
  name: string,
  description: string,
  blocks: PromptBlock[],
  tokenBudget?: PromptComposition["tokenBudget"]
): PromptCompositionScenePreset {
  return {
    id,
    name,
    description,
    composition: {
      id: `composition_scene_${id}`,
      name,
      version: 1,
      blocks,
      ...(tokenBudget ? { tokenBudget } : {}),
    },
  };
}

function template(id: string, name: string, value: string, order: number): PromptBlock {
  return {
    id,
    name,
    enabled: true,
    role: "system",
    source: { type: "template" },
    template: value,
    order,
    placement: { type: "ordered" },
  };
}

function history(id: string, name: string, order: number, count?: number): PromptBlock {
  return {
    id,
    name,
    enabled: true,
    role: "system",
    source: {
      type: "chat_history",
      selection: count === undefined
        ? { mode: "all" }
        : { mode: "recent", count, preserveFirstAssistant: true },
    },
    template: "",
    order,
    placement: { type: "ordered" },
  };
}

function droppable(block: PromptBlock, priority: number): PromptBlock {
  return { ...block, tokenPolicy: { overflow: "drop", priority } };
}
