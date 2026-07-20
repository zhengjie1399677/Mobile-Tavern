import type { PromptComposition } from "./types";

/**
 * 基础示例只描述如何自由组合数据源，不是编译器默认行为。
 * 调用方可以复制、修改或彻底删除；空编排同样合法。
 */
export function createBasicPromptComposition(): PromptComposition {
  return {
    id: "composition_mobile_tavern_basic_example",
    name: "基础自由编排示例",
    version: 1,
    blocks: [
      {
        id: "example_main",
        name: "基础指令示例",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "{{prompt.main}}",
        order: 100,
        placement: { type: "ordered" },
      },
      {
        id: "example_character",
        name: "角色卡资料示例",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}",
        order: 200,
        placement: { type: "ordered" },
      },
      {
        id: "example_worldbook",
        name: "世界书示例",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "{{worldbook.triggered}}",
        order: 300,
        placement: { type: "ordered" },
      },
      {
        id: "example_memory",
        name: "记忆示例",
        enabled: true,
        role: "system",
        source: { type: "template" },
        template: "{{memory.summaries}}\n\n{{memory.recalled}}\n\n{{memory.tables}}",
        order: 400,
        placement: { type: "ordered" },
      },
      {
        id: "example_history",
        name: "聊天历史",
        enabled: true,
        role: "system",
        source: {
          type: "chat_history",
          selection: { mode: "recent", count: 6, preserveFirstAssistant: true },
        },
        template: "",
        order: 500,
        placement: { type: "ordered" },
      },
      {
        id: "example_post_history",
        name: "历史后指令示例",
        enabled: false,
        role: "system",
        source: { type: "template" },
        template: "{{prompt.postHistory}}",
        order: 600,
        placement: { type: "ordered" },
      },
    ],
  };
}
