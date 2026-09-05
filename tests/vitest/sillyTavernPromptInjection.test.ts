import { describe, expect, it } from "vitest";
import {
  buildSillyTavernInjectionPromptSections,
  buildSillyTavernWorldInfoPromptSections,
} from "../../src/application/runtimePlugins/sillyTavernCompatibilityRuntimePlugin";
import { SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID } from "../../src/application/compatibility/contracts";
import type { CharacterCard, ChatSession, UserSettings } from "../../src/types";

describe("SillyTavern Compatibility Character Note / Depth Prompt", () => {
  it("把 card depth_prompt 和会话 Author’s Note 转为带元数据的 Prompt Nodes", () => {
    const character = {
      id: "character-injection",
      name: "角色",
      description: "描述",
      personality: "性格",
      scenario: "场景",
      first_mes: "开场",
      mes_example: "示例",
      extensions: {
        depth_prompt: {
          prompt: "深度设定：{{char}}",
          depth: 2,
          role: "assistant",
          allowWIScan: true,
        },
      },
    } as CharacterCard;
    const chat = {
      id: "session-injection",
      characterId: character.id,
      title: "注入测试",
      createdAt: 1,
      messages: [],
      summaries: [],
      runtimePluginState: {
        [SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID]: {
          authorNote: {
            content: "会话注记：{{user}}",
            depth: 4,
            role: "user",
            allow_wi_scan: true,
          },
        },
      },
    } as ChatSession;
    const settings = { userName: "用户" } as UserSettings;

    const nodes = buildSillyTavernInjectionPromptSections({
      character,
      chat,
      settings,
      hasVariableListEntry: false,
    });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: "sillytavern_depth_prompt_0",
      content: "深度设定：角色",
      metadata: {
        injection: "depth_prompt",
        depth: 2,
        role: "assistant",
        allowWIScan: true,
      },
    });
    expect(nodes[1]).toMatchObject({
      id: "sillytavern_author_note_1",
      content: "会话注记：用户",
      metadata: {
        injection: "author_note",
        depth: 4,
        role: "user",
        allowWIScan: true,
      },
    });
  });

  it("把 in_chat 与 before_last_mes 世界书条目保留为深度注入节点", () => {
    const character = {
      id: "character-world-info",
      name: "角色",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
    } as CharacterCard;
    const chat = {
      id: "session-world-info",
      characterId: character.id,
      title: "世界书测试",
      createdAt: 1,
      messages: [],
      summaries: [],
    } as ChatSession;

    const nodes = buildSillyTavernWorldInfoPromptSections({
      character,
      chat,
      settings: { userName: "用户" } as UserSettings,
      hasVariableListEntry: false,
      triggeredLorebookEntries: [
        {
          id: "deep",
          keys: [],
          content: "深层设定 {{char}}",
          constant: true,
          enabled: true,
          position: "in_chat",
          depth: 3,
          order: 80,
        },
        {
          id: "last",
          keys: [],
          content: "最后消息前",
          constant: true,
          enabled: true,
          position: "before_last_mes",
        },
      ],
    });

    expect(nodes).toMatchObject([
      {
        content: "深层设定 角色",
        metadata: { position: "in_chat", depth: 3, order: 80, role: "system" },
      },
      {
        content: "最后消息前",
        metadata: { position: "in_chat", depth: 1, role: "system" },
      },
    ]);
  });
});
