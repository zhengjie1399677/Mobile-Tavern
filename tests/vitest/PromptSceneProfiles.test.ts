import { describe, expect, it } from "vitest";
import {
  applyPromptSceneProfile,
  createPromptSceneProfile,
  parsePromptComposition,
  type PromptComposition,
} from "../../src/domain/prompt-composition";
import { PromptService } from "../../src/application/services/PromptService";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { CharacterCard, ChatSession } from "../../src/types";

const composition: PromptComposition = {
  id: "scene-test",
  name: "场景测试",
  version: 1,
  blocks: [
    {
      id: "base",
      name: "基础",
      enabled: true,
      role: "system",
      source: { type: "template" },
      template: "BASE",
      order: 100,
      placement: { type: "ordered" },
    },
    {
      id: "combat",
      name: "战斗",
      enabled: false,
      role: "system",
      source: { type: "template" },
      template: "COMBAT",
      order: 200,
      placement: { type: "ordered" },
    },
  ],
};

describe("Prompt 会话场景方案", () => {
  it("仅覆盖方案中声明的区块开关", () => {
    const profile = createPromptSceneProfile("战斗场景", {
      ...composition,
      blocks: composition.blocks.map((block) => block.id === "combat" ? { ...block, enabled: true } : block),
    }, "combat-scene");
    const source = { ...composition, sceneProfiles: [profile] };
    const resolved = applyPromptSceneProfile(source, "combat-scene");
    expect(resolved.composition.blocks.map((block) => block.enabled)).toEqual([true, true]);
    expect(composition.blocks.map((block) => block.enabled)).toEqual([true, false]);
  });

  it("编排导入会清洗并保留场景方案", () => {
    const parsed = parsePromptComposition({
      ...composition,
      sceneProfiles: [{ id: "quiet", name: "安静", blockStates: { base: true, combat: false } }],
    });
    expect(parsed.sceneProfiles?.[0]).toEqual({
      id: "quiet",
      name: "安静",
      blockStates: { base: true, combat: false },
    });
  });

  it("PromptService 按当前会话选择编译，不修改全局编排", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.promptConfig.usePromptComposition = true;
    settings.promptConfig.composition = {
      ...composition,
      sceneProfiles: [{ id: "combat-scene", name: "战斗", blockStates: { combat: true } }],
    };
    const result = new PromptService().assemblePrompt({
      character: {
        id: "character",
        name: "角色",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        lorebookEntries: [],
      } as CharacterCard,
      chat: {
        id: "session",
        characterId: "character",
        title: "测试",
        createdAt: 1,
        messages: [],
        summaries: [],
        activePromptSceneProfileId: "combat-scene",
      } as ChatSession,
      userInput: "",
      settings,
      globalLorebook: [],
    });
    expect(result.messages?.map((message) => message.content)).toEqual(["BASE", "COMBAT"]);
    expect(settings.promptConfig.composition.blocks[1].enabled).toBe(false);
  });
});
