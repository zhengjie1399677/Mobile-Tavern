import type { IKernel } from "../../kernel/types";
import type {
  IRuntimeProfileService,
  RuntimeProfileCapabilities,
  RuntimeProfileCatalogSnapshot,
  RuntimeProfileRecord,
  RuntimeProfileRuntimeDiagnostics,
} from "../runtimeProfiles/contracts";
import { BUILTIN_TAVERN_PROFILE_ID } from "../runtimeProfiles/contracts";
import {
  findRuntimeProfile,
  listRuntimeProfileRecords,
  resolveRuntimeProfileSelection,
} from "../runtimeProfiles/catalog";
import {
  readRuntimeProfilePreferences,
  writeRuntimeProfilePreferences,
} from "../../infrastructure/runtimeProfiles/runtimeProfilePreferences";
import {
  KernelServices,
  type IAgentRuntimeService,
  type ICompatibilityRuntimeService,
} from "../serviceContracts";
import {
  AUDIO_ASR_PROCESSOR_ID,
  resolveBuiltinProviderId,
  VIDEO_KEYFRAME_PROCESSOR_ID,
} from "../runtimePlugins/agentSpineRuntimePlugin";
import type { ApiType } from "../../types";

const PROFILE_NAME_MAX_LENGTH = 80;

export class RuntimeProfileService implements IRuntimeProfileService {
  readonly name = "runtimeProfiles";
  readonly isCritical = false;
  readonly dependencies = [KernelServices.AgentRuntime, KernelServices.CompatibilityRuntime] as const;

  private kernel: IKernel | null = null;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  destroy(): void {
    this.kernel = null;
  }

  listProfiles(): RuntimeProfileCatalogSnapshot {
    const read = readRuntimeProfilePreferences();
    const resolution = resolveRuntimeProfileSelection(read.state, read.invalidStoredValue);
    const activeComposition = this.getAgentRuntime()?.getCompositionSnapshot() ?? null;
    return {
      selectedProfileId: resolution.profile.id,
      activeProfileId: activeComposition?.profileId ?? null,
      activeProfileVersion: activeComposition?.profileVersion ?? null,
      profiles: listRuntimeProfileRecords(read.state),
      diagnostics: resolution.diagnostics,
    };
  }

  copyProfile(sourceProfileId: string, name: string): RuntimeProfileRecord {
    const state = readRuntimeProfilePreferences().state;
    const source = findRuntimeProfile(state, sourceProfileId);
    if (!source) throw new Error(`RUNTIME_PROFILE_NOT_FOUND: ${sourceProfileId}`);
    const normalizedName = normalizeName(name);
    const now = Date.now();
    const profile: RuntimeProfileRecord = {
      id: createUserProfileId(),
      name: normalizedName,
      schemaVersion: 1,
      version: 1,
      builtin: false,
      copiedFrom: source.id,
      capabilities: { ...source.capabilities },
      createdAt: now,
      updatedAt: now,
    };
    writeRuntimeProfilePreferences({
      ...state,
      customProfiles: [...state.customProfiles, profile],
    });
    return profile;
  }

  updateCapabilities(
    profileId: string,
    capabilities: Partial<RuntimeProfileCapabilities>,
  ): RuntimeProfileRecord {
    const state = readRuntimeProfilePreferences().state;
    const existing = state.customProfiles.find((profile) => profile.id === profileId);
    if (!existing) throw new Error(`RUNTIME_PROFILE_NOT_EDITABLE: ${profileId}`);
    const updated: RuntimeProfileRecord = {
      ...existing,
      version: existing.version + 1,
      capabilities: { ...existing.capabilities, ...capabilities },
      updatedAt: Date.now(),
    };
    writeRuntimeProfilePreferences({
      ...state,
      customProfiles: state.customProfiles.map((profile) =>
        profile.id === profileId ? updated : profile),
    });
    return updated;
  }

  deleteProfile(profileId: string): void {
    const state = readRuntimeProfilePreferences().state;
    if (!state.customProfiles.some((profile) => profile.id === profileId)) {
      throw new Error(`RUNTIME_PROFILE_NOT_EDITABLE: ${profileId}`);
    }
    writeRuntimeProfilePreferences({
      ...state,
      selectedProfileId: state.selectedProfileId === profileId
        ? BUILTIN_TAVERN_PROFILE_ID
        : state.selectedProfileId,
      customProfiles: state.customProfiles.filter((profile) => profile.id !== profileId),
    });
  }

  selectProfile(profileId: string): RuntimeProfileRecord {
    const state = readRuntimeProfilePreferences().state;
    const profile = findRuntimeProfile(state, profileId);
    if (!profile) throw new Error(`RUNTIME_PROFILE_NOT_FOUND: ${profileId}`);
    writeRuntimeProfilePreferences({ ...state, selectedProfileId: profile.id });
    return profile;
  }

  getDiagnostics(profileId: string, apiType: ApiType): RuntimeProfileRuntimeDiagnostics {
    const state = readRuntimeProfilePreferences().state;
    const profile = findRuntimeProfile(state, profileId)
      ?? resolveRuntimeProfileSelection(state).profile;
    const agentRuntime = this.getAgentRuntime();
    const agentDiagnostics = agentRuntime?.getDiagnostics();
    const providerId = resolveBuiltinProviderId(apiType);
    const provider = agentRuntime?.listProviders().find((candidate) => candidate.id === providerId);
    const compatibility = this.getCompatibilityRuntime()?.getDiagnostics();
    const activeComposition = agentRuntime?.getCompositionSnapshot() ?? null;
    const activeProfileId = activeComposition?.profileId ?? null;
    const activeProfileVersion = activeComposition?.profileVersion ?? null;
    const mediaProcessors = agentDiagnostics?.mediaProcessors.map((item) => item.id) ?? [];
    const warnings: string[] = [];
    if (activeProfileId !== profile.id || activeProfileVersion !== profile.version) {
      warnings.push("此 Profile 或其最新版本尚未装载，需要重启运行时后生效。");
    }
    if (!provider) warnings.push(`当前 API 类型缺少可用 Provider：${providerId}`);
    if (profile.capabilities.sillyTavernCompatibility && compatibility?.renderers.length === 0) {
      warnings.push("SillyTavern Renderer 未装载，HTML/MVU 将按普通消息降级。");
    }
    if (profile.capabilities.audioAsrFallback && !mediaProcessors.includes(AUDIO_ASR_PROCESSOR_ID)) {
      warnings.push("音频 ASR 处理器未装载，音频将不可投影给当前 Provider。");
    }
    if (profile.capabilities.videoKeyframeFallback && !mediaProcessors.includes(VIDEO_KEYFRAME_PROCESSOR_ID)) {
      warnings.push("视频关键帧处理器未装载，视频将不可投影给当前 Provider。");
    }
    return {
      profileId: profile.id,
      active: activeProfileId === profile.id && activeProfileVersion === profile.version,
      provider: {
        id: providerId,
        available: provider !== undefined,
        inputModalities: provider?.capabilities.inputModalities ?? [],
        supportsTools: provider?.capabilities.supportsTools ?? false,
      },
      drivers: agentDiagnostics?.drivers.map((item) => item.id) ?? [],
      tools: agentDiagnostics?.tools.map((item) => item.name) ?? [],
      promptSections: compatibility?.promptSections ?? [],
      renderers: compatibility?.renderers ?? [],
      mediaProcessors,
      mediaFallbacks: {
        audio: mediaProcessors.includes(AUDIO_ASR_PROCESSOR_ID) ? "ASR 转写为文本" : "不可用",
        video: mediaProcessors.includes(VIDEO_KEYFRAME_PROCESSOR_ID) ? "提取关键帧并按图片发送" : "不可用",
      },
      warnings,
    };
  }

  private getAgentRuntime(): IAgentRuntimeService | null {
    return this.kernel?.hasService(KernelServices.AgentRuntime)
      ? this.kernel.getService<IAgentRuntimeService>(KernelServices.AgentRuntime)
      : null;
  }

  private getCompatibilityRuntime(): ICompatibilityRuntimeService | null {
    return this.kernel?.hasService(KernelServices.CompatibilityRuntime)
      ? this.kernel.getService<ICompatibilityRuntimeService>(KernelServices.CompatibilityRuntime)
      : null;
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim().slice(0, PROFILE_NAME_MAX_LENGTH);
  if (!normalized) throw new Error("RUNTIME_PROFILE_NAME_EMPTY");
  return normalized;
}

function createUserProfileId(): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2);
  return `user.profile.${Date.now().toString(36)}.${randomPart}`;
}
