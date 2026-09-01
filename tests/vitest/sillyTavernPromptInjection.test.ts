import { describe, expect, it } from "vitest";
import {
  buildSillyTavernInjectionPromptSections,
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
});
