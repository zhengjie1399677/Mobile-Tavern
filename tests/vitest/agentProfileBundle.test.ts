import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_BASE_PROFILE_ID,
  BUILTIN_TAVERN_PROFILE_ID,
  type RuntimeProfileRecord,
} from "../../src/application/runtimeProfiles/contracts";
import { buildRuntimeProfileDefinition } from "../../src/application/runtimeProfiles/catalog";
import { RuntimeProfileService } from "../../src/application/services/RuntimeProfileService";
import { prepareAgentProfileBundleExport } from "../../src/application/useCases/prepareAgentProfileBundleExport";
import { prepareAgentProfileBundleImport } from "../../src/application/useCases/prepareAgentProfileBundleImport";
import {
  clearRuntimeProfilePreferencesForTests,
  readRuntimeProfilePreferences,
} from "../../src/infrastructure/runtimeProfiles/runtimeProfilePreferences";

const sourceProfile: RuntimeProfileRecord = {
  id: "user.profile.source",
  name: "旅行助手",
  schemaVersion: 1,
  version: 4,
  builtin: false,
  capabilities: {
    sillyTavernCompatibility: false,
    audioAsrFallback: true,
    videoKeyframeFallback: false,
  },
  agent: {
    characterId: "character-guide",
    toolMounts: [
      { name: "character.read", version: "1.0.0" },
      { name: "ext.weather.lookup", version: "2.1.0" },
    ],
    promptPresetId: "preset-travel",
    sampling: {
      temperature: 0.65,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.05,
      frequencyPenalty: 0,
      presencePenalty: 0,
      minP: 0,
      maxTokens: 900,
    },
  },
  createdAt: 10,
  updatedAt: 20,
};

describe("Agent/Profile Bundle v1", () => {
  beforeEach(() => clearRuntimeProfilePreferencesForTests());

  it("导出角色引用、Tool 挂载、行为采样与能力开关，且不复制未知凭据字段", () => {
    const profileWithRogueSecret = {
      ...sourceProfile,
      apiKey: "must-not-enter-agent-profile-bundle",
    } as RuntimeProfileRecord;

    const exported = prepareAgentProfileBundleExport({
      profile: profileWithRogueSecret,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 100,
    });

    expect(exported.fileName).toBe("旅行助手.agent-profile.json");
    expect(exported.data).toMatchObject({
      kind: "mobile-tavern.agent-profile",
      schemaVersion: 1,
      exportedAt: 100,
      profile: {
        name: "旅行助手",
        source: { id: "user.profile.source", version: 4 },
        capabilities: sourceProfile.capabilities,
        character: { id: "character-guide", name: "向导" },
        tools: sourceProfile.agent?.toolMounts,
        behavior: {
          promptPreset: { id: "preset-travel", name: "旅行行为" },
          sampling: sourceProfile.agent?.sampling,
        },
      },
    });
    expect(JSON.stringify(exported.data)).not.toContain("must-not-enter-agent-profile-bundle");
    expect(JSON.stringify(exported.data)).not.toContain("apiKey");
  });

  it("跨设备导入时生成新 Profile，并保留缺失依赖引用与明确诊断", () => {
    const exported = prepareAgentProfileBundleExport({
      profile: sourceProfile,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 100,
    });

    const imported = prepareAgentProfileBundleImport({
      input: exported.data,
      createProfileId: () => "user.profile.imported",
      existingProfileIds: ["user.profile.source"],
      availableCharacterIds: [],
      availablePromptPresetIds: [],
      availableTools: [{ name: "character.read", version: "1.0.0" }],
    });

    expect(imported.profile).toMatchObject({
      id: "user.profile.imported",
      name: "旅行助手",
      version: 1,
      builtin: false,
      capabilities: sourceProfile.capabilities,
      agent: sourceProfile.agent,
    });
    expect(imported.diagnostics.map((item) => item.code)).toEqual([
      "PROFILE_ID_REGENERATED",
      "CHARACTER_NOT_FOUND",
      "TOOL_NOT_FOUND",
      "PROMPT_PRESET_NOT_FOUND",
    ]);
  });

  it("Tool 已安装但版本不匹配时保留挂载并给出版本诊断", () => {
    const exported = prepareAgentProfileBundleExport({
      profile: sourceProfile,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 100,
    });
    const imported = prepareAgentProfileBundleImport({
      input: exported.data,
      createProfileId: () => "user.profile.version-check",
      availableTools: [
        { name: "character.read", version: "1.0.0" },
        { name: "ext.weather.lookup", version: "2.0.0" },
      ],
    });

    expect(imported.profile.agent?.toolMounts).toEqual(sourceProfile.agent?.toolMounts);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: "TOOL_VERSION_MISMATCH",
      referenceId: "ext.weather.lookup",
    }));
  });

  it("拒绝未知字段和伪装成 Bundle 的凭据载荷", () => {
    const exported = prepareAgentProfileBundleExport({
      profile: sourceProfile,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 100,
    });
    const input = structuredClone(exported.data) as unknown as Record<string, unknown>;
    input.apiKey = "secret";

    expect(() => prepareAgentProfileBundleImport({
      input,
      createProfileId: () => "user.profile.imported",
    })).toThrow("AGENT_PROFILE_BUNDLE_INVALID");
  });

  it("导入结果可持久化，并在再次导出时保持可移植语义", () => {
    const firstExport = prepareAgentProfileBundleExport({
      profile: sourceProfile,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 100,
    });
    const imported = prepareAgentProfileBundleImport({
      input: firstExport.data,
      createProfileId: () => "user.profile.imported",
      now: 200,
      availableCharacterIds: ["character-guide"],
      availablePromptPresetIds: ["preset-travel"],
      availableTools: sourceProfile.agent?.toolMounts ?? [],
    });
    const service = new RuntimeProfileService();
    const persisted = service.createProfile(imported.profile);
    const secondExport = prepareAgentProfileBundleExport({
      profile: persisted,
      character: { id: "character-guide", name: "向导" },
      promptPreset: { id: "preset-travel", name: "旅行行为" },
      exportedAt: 300,
    });

    expect(readRuntimeProfilePreferences().state.customProfiles).toContainEqual(persisted);
    expect(secondExport.data.profile).toEqual({
      ...(firstExport.data.profile as Record<string, unknown>),
      source: { id: "user.profile.imported", version: 1 },
    });
  });

  it("旧 Profile 缺少 Agent 字段时继续获得现有两项 Tool，Base/Tavern 隔离不变", () => {
    const service = new RuntimeProfileService();
    const snapshot = service.listProfiles();
    const base = snapshot.profiles.find((profile) => profile.id === BUILTIN_BASE_PROFILE_ID)!;
    const tavern = snapshot.profiles.find((profile) => profile.id === BUILTIN_TAVERN_PROFILE_ID)!;

    expect(buildRuntimeProfileDefinition(base).contributions?.tool).toEqual([
      "character.read",
      "session.branch",
    ]);
    expect(buildRuntimeProfileDefinition(base).plugins.map((plugin) => plugin.id)).not.toContain(
      "mobile-tavern.sillytavern-compat",
    );
    expect(buildRuntimeProfileDefinition(tavern).plugins.map((plugin) => plugin.id)).toContain(
      "mobile-tavern.sillytavern-compat",
    );
  });

  it("自定义 Tool 挂载只把已选择的内置 Tool 写入 Profile 组合", () => {
    expect(buildRuntimeProfileDefinition(sourceProfile).contributions?.tool).toEqual([
      "character.read",
    ]);
  });
});
