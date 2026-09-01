import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IKernel } from "../../src/kernel/types";
import { RuntimeProfileService } from "../../src/application/services/RuntimeProfileService";
import {
  BUILTIN_BASE_PROFILE_ID,
  BUILTIN_TAVERN_PROFILE_ID,
} from "../../src/application/runtimeProfiles/contracts";
import {
  buildRuntimeProfileDefinition,
  resolveRuntimeProfileSelection,
} from "../../src/application/runtimeProfiles/catalog";
import {
  clearRuntimeProfilePreferencesForTests,
  readRuntimeProfilePreferences,
} from "../../src/infrastructure/runtimeProfiles/runtimeProfilePreferences";
import { canRunSessionWithProfile, getSessionRuntimeProfileId } from "../../src/application/useCases/runtimeProfileSession";
import { prepareRuntimeProfileSessionResume } from "../../src/application/useCases/runtimeProfileSessionResume";
import {
  clearRuntimeProfileSessionResumeIntent,
  readRuntimeProfileSessionResumeIntent,
} from "../../src/infrastructure/runtimeProfiles/runtimeProfileSessionResume";
import type { ChatSession } from "../../src/types";

describe("RuntimeProfileService", () => {
  beforeEach(() => {
    clearRuntimeProfilePreferencesForTests();
    clearRuntimeProfileSessionResumeIntent();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearRuntimeProfilePreferencesForTests();
    clearRuntimeProfileSessionResumeIntent();
  });

  it("首次启动默认选择 Tavern Agent，同时提供不受兼容能力污染的 Base Agent", () => {
    const service = new RuntimeProfileService();
    const snapshot = service.listProfiles();

    expect(snapshot.selectedProfileId).toBe(BUILTIN_TAVERN_PROFILE_ID);
    expect(snapshot.profiles.map((profile) => profile.id)).toEqual([
      BUILTIN_BASE_PROFILE_ID,
      BUILTIN_TAVERN_PROFILE_ID,
    ]);
    expect(snapshot.profiles[0].capabilities.sillyTavernCompatibility).toBe(false);
    expect(snapshot.profiles[1].capabilities.sillyTavernCompatibility).toBe(true);
  });

  it("复制 Profile 后可独立开关兼容与媒体贡献，并持久化选中项", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "我的 Base Agent");
    const updated = service.updateCapabilities(copied.id, {
      sillyTavernCompatibility: true,
      videoKeyframeFallback: false,
    });
    service.selectProfile(updated.id);

    const stored = readRuntimeProfilePreferences().state;
    expect(stored.selectedProfileId).toBe(updated.id);
    const definition = buildRuntimeProfileDefinition(updated);
    expect(definition.version).toBe(2);
    expect(definition.bindings?.["llm.route"]).toBe("provider.route.settings");
    expect(definition.plugins.map((plugin) => plugin.id)).toContain(
      "mobile-tavern.sillytavern-compat",
    );
    expect(definition.contributions?.["media.processor"]).toEqual(["media.audio.asr"]);
    expect(definition.contributions?.tool).toEqual([
      "character.read",
      "session.branch",
    ]);
  });

  it("编辑自定义 Agent 粘合配置时递增版本并保持内置 Profile 只读", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "可编辑 Agent");
    const updated = service.updateAgentSettings(copied.id, {
      characterId: "character-guide",
      toolMounts: [{ name: "character.read", version: "1.0.0" }],
      promptPresetId: "preset-guide",
      sampling: {
        temperature: 0.6,
        topP: 0.9,
        topK: 40,
        repetitionPenalty: 1.05,
        maxTokens: 800,
      },
    });

    expect(updated.version).toBe(2);
    expect(readRuntimeProfilePreferences().state.customProfiles[0].agent).toEqual(updated.agent);
    expect(() => service.updateAgentSettings(BUILTIN_BASE_PROFILE_ID, {
      toolMounts: [],
    })).toThrow(`RUNTIME_PROFILE_NOT_EDITABLE: ${BUILTIN_BASE_PROFILE_ID}`);
  });

  it("删除当前自定义 Profile 时回退 Tavern Agent，不留下悬空选择", () => {
    const service = new RuntimeProfileService();
    const copied = service.copyProfile(BUILTIN_BASE_PROFILE_ID, "临时 Profile");
    service.selectProfile(copied.id);
    service.deleteProfile(copied.id);

    expect(service.listProfiles().selectedProfileId).toBe(BUILTIN_TAVERN_PROFILE_ID);
  });

  it("损坏或版本不兼容的启动配置安全回退并返回诊断", () => {
    localStorage.setItem("mobile-tavern.runtime-profiles.v1", JSON.stringify({ schemaVersion: 99 }));
    const read = readRuntimeProfilePreferences();
    const resolution = resolveRuntimeProfileSelection(read.state, read.invalidStoredValue);

    expect(resolution.profile.id).toBe(BUILTIN_TAVERN_PROFILE_ID);
    expect(resolution.diagnostics.map((item) => item.code)).toContain("PROFILE_INVALID");
  });

  it("缺失 Provider 和未装载 Profile 只产生诊断，不让设置页崩溃", () => {
    const service = new RuntimeProfileService();
    service.init({ hasService: () => false } as unknown as IKernel);

    const diagnostics = service.getDiagnostics(BUILTIN_BASE_PROFILE_ID, "anthropic");
    expect(diagnostics.active).toBe(false);
    expect(diagnostics.provider.available).toBe(false);
    expect(diagnostics.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("需要重启"),
      expect.stringContaining("缺少可用 Provider"),
    ]));
  });

  it("无组合快照的旧会话继续按 Tavern Agent 解释", () => {
    const session = {
      id: "legacy-session",
      characterId: "character",
      title: "旧会话",
      createdAt: 1,
      messages: [],
      summaries: [],
    } satisfies ChatSession;

    expect(getSessionRuntimeProfileId(session)).toBe(BUILTIN_TAVERN_PROFILE_ID);
    expect(canRunSessionWithProfile(session, {
      profileId: BUILTIN_TAVERN_PROFILE_ID,
      profileVersion: 3,
    })).toBe(true);
  });

  it("同 ID Profile 更新能力后，旧会话因版本不同被拒绝继续运行", () => {
    const session = {
      id: "versioned-session",
      characterId: "character",
      title: "版本会话",
      createdAt: 1,
      messages: [],
      summaries: [],
      compositionSnapshot: {
        profileId: "user.profile.demo",
        profileVersion: 1,
        pluginVersions: {},
        providerBindings: {},
        contributionOrder: {},
        capabilityDecisions: {},
      },
    } satisfies ChatSession;

    expect(canRunSessionWithProfile(session, {
      profileId: "user.profile.demo",
      profileVersion: 2,
    })).toBe(false);
  });

  it("跨 Profile 会话跳转会选择目标 Profile 并保存重载恢复意图", () => {
    const profileService = new RuntimeProfileService();
    const kernel = {
      hasService: (name: string) => name === "agentRuntime",
      getService: (name: string) => name === "agentRuntime"
        ? {
            getCompositionSnapshot: () => ({
              profileId: BUILTIN_BASE_PROFILE_ID,
              profileVersion: 1,
            }),
          }
        : profileService,
    } as unknown as IKernel;
    const tavernSession = {
      id: "tavern-session",
      characterId: "character-1",
      title: "Tavern 会话",
      createdAt: 1,
      messages: [],
      summaries: [],
      compositionSnapshot: {
        profileId: BUILTIN_TAVERN_PROFILE_ID,
        profileVersion: 3,
        pluginVersions: {},
        providerBindings: {},
        contributionOrder: {},
        capabilityDecisions: {},
      },
    } satisfies ChatSession;

    expect(prepareRuntimeProfileSessionResume(kernel, tavernSession)).toEqual({ status: "reload" });
    expect(profileService.listProfiles().selectedProfileId).toBe(BUILTIN_TAVERN_PROFILE_ID);
    expect(readRuntimeProfileSessionResumeIntent()).toEqual({
      schemaVersion: 1,
      sessionId: tavernSession.id,
      characterId: tavernSession.characterId,
      profileId: BUILTIN_TAVERN_PROFILE_ID,
      profileVersion: 3,
    });
  });

  it("恢复意图存储不可用时不改变已选择的 Profile", () => {
    const profileService = new RuntimeProfileService();
    profileService.selectProfile(BUILTIN_BASE_PROFILE_ID);
    const kernel = {
      hasService: () => true,
      getService: (name: string) => name === "agentRuntime"
        ? { getCompositionSnapshot: () => ({ profileId: BUILTIN_BASE_PROFILE_ID, profileVersion: 1 }) }
        : profileService,
    } as unknown as IKernel;
    const tavernSession = {
      id: "tavern-session-storage-failure",
      characterId: "character-1",
      title: "Tavern 会话",
      createdAt: 1,
      messages: [],
      summaries: [],
      compositionSnapshot: {
        profileId: BUILTIN_TAVERN_PROFILE_ID,
        profileVersion: 3,
        pluginVersions: {},
        providerBindings: {},
        contributionOrder: {},
        capabilityDecisions: {},
      },
    } satisfies ChatSession;
    vi.stubGlobal("sessionStorage", undefined);

    expect(prepareRuntimeProfileSessionResume(kernel, tavernSession)).toMatchObject({
      status: "unavailable",
    });
    expect(profileService.listProfiles().selectedProfileId).toBe(BUILTIN_BASE_PROFILE_ID);
  });

  it("Profile 已删除或版本不可用时拒绝重载，不产生悬空恢复意图", () => {
    const profileService = new RuntimeProfileService();
    const kernel = {
      hasService: () => true,
      getService: (name: string) => name === "agentRuntime"
        ? { getCompositionSnapshot: () => ({ profileId: BUILTIN_BASE_PROFILE_ID, profileVersion: 1 }) }
        : profileService,
    } as unknown as IKernel;
    const missingSession = {
      id: "missing-session",
      characterId: "character-1",
      title: "缺失 Profile",
      createdAt: 1,
      messages: [],
      summaries: [],
      compositionSnapshot: {
        profileId: "user.profile.deleted",
        profileVersion: 1,
        pluginVersions: {},
        providerBindings: {},
        contributionOrder: {},
        capabilityDecisions: {},
      },
    } satisfies ChatSession;

    expect(prepareRuntimeProfileSessionResume(kernel, missingSession)).toMatchObject({
      status: "unavailable",
    });
    expect(readRuntimeProfileSessionResumeIntent()).toBeNull();
  });
});
