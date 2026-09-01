import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeProfileService } from "../../src/application/services/RuntimeProfileService";
import { BUILTIN_BASE_PROFILE_ID } from "../../src/application/runtimeProfiles/contracts";
import { prepareRuntimeProfileAgentLaunch } from "../../src/application/useCases/runtimeProfileAgentLaunch";
import {
  clearRuntimeProfileAgentLaunchIntent,
  readRuntimeProfileAgentLaunchIntent,
} from "../../src/infrastructure/runtimeProfiles/runtimeProfileAgentLaunch";
import { clearRuntimeProfilePreferencesForTests } from "../../src/infrastructure/runtimeProfiles/runtimeProfilePreferences";

describe("runtimeProfileAgentLaunch", () => {
  beforeEach(() => {
    clearRuntimeProfilePreferencesForTests();
    clearRuntimeProfileAgentLaunchIntent();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearRuntimeProfilePreferencesForTests();
    clearRuntimeProfileAgentLaunchIntent();
  });

  it("依赖齐全时先保存一次性意图，再选择目标 Profile", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "向导 Agent");
    const profile = service.updateAgentSettings(copied.id, {
      characterId: "character-guide",
      promptPresetId: "preset-guide",
      toolMounts: [{ name: "character.read", version: "1.0.0" }],
    });

    expect(prepareRuntimeProfileAgentLaunch({
      service,
      profile,
      availableCharacterIds: ["character-guide"],
      availablePromptPresetIds: ["preset-guide"],
      availableTools: [{ name: "character.read", version: "1.0.0" }],
    })).toEqual({ status: "reload" });
    expect(readRuntimeProfileAgentLaunchIntent()).toEqual({
      schemaVersion: 1,
      profileId: profile.id,
      profileVersion: profile.version,
      characterId: "character-guide",
    });
    expect(service.listProfiles().selectedProfileId).toBe(profile.id);
  });

  it("角色、行为预设或 Tool 缺失时拒绝切换 Profile", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "缺依赖 Agent");
    const profile = service.updateAgentSettings(copied.id, {
      characterId: "character-missing",
      promptPresetId: "preset-missing",
      toolMounts: [{ name: "tool-missing", version: "1.0.0" }],
    });

    expect(prepareRuntimeProfileAgentLaunch({
      service,
      profile,
      availableCharacterIds: [],
      availablePromptPresetIds: [],
      availableTools: [],
    })).toMatchObject({ status: "unavailable", message: expect.stringContaining("角色不存在") });
    expect(readRuntimeProfileAgentLaunchIntent()).toBeNull();
    expect(service.listProfiles().selectedProfileId).not.toBe(profile.id);
  });

  it("一次性存储不可用时保持原 Profile", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "存储失败 Agent");
    const profile = service.updateAgentSettings(copied.id, {
      characterId: "character-guide",
      toolMounts: [],
    });
    vi.stubGlobal("sessionStorage", undefined);

    expect(prepareRuntimeProfileAgentLaunch({
      service,
      profile,
      availableCharacterIds: ["character-guide"],
      availablePromptPresetIds: [],
      availableTools: [],
    })).toMatchObject({ status: "unavailable" });
    expect(service.listProfiles().selectedProfileId).not.toBe(profile.id);
  });
});
