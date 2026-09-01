import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_SETTINGS_DECISION_ID } from "../../src/application/runtimeProfiles/agentSettings";
import { resolveAgentSessionSettings } from "../../src/application/useCases/resolveAgentSessionSettings";
import type { AgentCompositionSnapshot } from "../../src/domain/agents/contracts";
import type { UserSettings } from "../../src/types";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";

function createSnapshot(decision: unknown): AgentCompositionSnapshot {
  return {
    profileId: "user.profile.guide",
    profileVersion: 2,
    pluginVersions: {},
    providerBindings: {},
    contributionOrder: {},
    capabilityDecisions: {
      [AGENT_PROFILE_SETTINGS_DECISION_ID]: decision,
    },
  };
}

describe("resolveAgentSessionSettings", () => {
  it("旧会话没有 Agent 决策时保持全局设置引用不变", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as UserSettings;
    const snapshot = createSnapshot(undefined);

    expect(resolveAgentSessionSettings(settings, {
      ...snapshot,
      capabilityDecisions: {},
    })).toBe(settings);
  });

  it("按冻结引用应用行为预设、Regex 与 Agent 采样覆盖", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as UserSettings;
    const behavior = {
      id: "preset-guide",
      preset: {
        ...settings.preset,
        id: "sampler-guide",
        name: "向导行为",
        temperature: 0.9,
      },
      promptConfig: {
        ...settings.promptConfig,
        mainPrompt: "固定向导行为",
      },
      presetRegexScripts: [{
        id: "regex-guide",
        scriptName: "向导清理",
        findRegex: "foo",
        replaceString: "bar",
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      }],
    };
    settings.savedPresets = [behavior];

    const resolved = resolveAgentSessionSettings(settings, createSnapshot({
      characterId: "character-guide",
      toolMounts: [],
      promptPresetId: behavior.id,
      sampling: {
        temperature: 0.55,
        topP: 0.8,
        topK: 30,
        repetitionPenalty: 1.1,
        maxTokens: 700,
      },
    }));

    expect(resolved.promptConfig.mainPrompt).toBe("固定向导行为");
    expect(resolved.preset).toMatchObject({
      id: "sampler-guide",
      temperature: 0.55,
      topP: 0.8,
      maxTokens: 700,
    });
    expect(resolved.presetRegexScripts).toEqual(behavior.presetRegexScripts);
    expect(settings.promptConfig.mainPrompt).not.toBe("固定向导行为");
  });

  it("冻结行为预设已删除时拒绝静默改用全局预设", () => {
    const settings = structuredClone(DEFAULT_SETTINGS) as UserSettings;

    expect(() => resolveAgentSessionSettings(settings, createSnapshot({
      toolMounts: [],
      promptPresetId: "preset-missing",
    }))).toThrow("AGENT_PROMPT_PRESET_NOT_FOUND: preset-missing");
  });
});
