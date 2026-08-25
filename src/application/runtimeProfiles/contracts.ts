import type { ApiType } from "../../types";
import type { IKernelService } from "../../kernel/types";

export const BUILTIN_BASE_PROFILE_ID = "mobile-tavern.base";
export const BUILTIN_TAVERN_PROFILE_ID = "mobile-tavern.tavern";

export type RuntimeProfileCapabilityId =
  | "compat.sillytavern"
  | "media.audio.asr"
  | "media.video.keyframes";

export interface RuntimeProfileCapabilities {
  readonly sillyTavernCompatibility: boolean;
  readonly audioAsrFallback: boolean;
  readonly videoKeyframeFallback: boolean;
}

export interface RuntimeProfileRecord {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: 1;
  readonly version: number;
  readonly builtin: boolean;
  readonly copiedFrom?: string;
  readonly capabilities: RuntimeProfileCapabilities;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RuntimeProfilePreferenceState {
  readonly schemaVersion: 1;
  readonly selectedProfileId: string;
  readonly customProfiles: readonly RuntimeProfileRecord[];
}

export interface RuntimeProfileResolutionDiagnostic {
  readonly code: "PROFILE_NOT_FOUND" | "PROFILE_UPDATED" | "PROFILE_INVALID";
  readonly message: string;
}

export interface RuntimeProfileCatalogSnapshot {
  readonly selectedProfileId: string;
  readonly activeProfileId: string | null;
  readonly activeProfileVersion: number | null;
  readonly profiles: readonly RuntimeProfileRecord[];
  readonly diagnostics: readonly RuntimeProfileResolutionDiagnostic[];
}

export interface RuntimeProfileRuntimeDiagnostics {
  readonly profileId: string;
  readonly active: boolean;
  readonly provider: {
    readonly id: string;
    readonly available: boolean;
    readonly inputModalities: readonly string[];
    readonly supportsTools: boolean;
  };
  readonly drivers: readonly string[];
  readonly tools: readonly string[];
  readonly promptSections: readonly string[];
  readonly renderers: readonly string[];
  readonly mediaProcessors: readonly string[];
  readonly mediaFallbacks: Readonly<Record<"audio" | "video", string>>;
  readonly warnings: readonly string[];
}

export interface IRuntimeProfileService extends IKernelService {
  listProfiles(): RuntimeProfileCatalogSnapshot;
  copyProfile(sourceProfileId: string, name: string): RuntimeProfileRecord;
  updateCapabilities(
    profileId: string,
    capabilities: Partial<RuntimeProfileCapabilities>,
  ): RuntimeProfileRecord;
  deleteProfile(profileId: string): void;
  selectProfile(profileId: string): RuntimeProfileRecord;
  getDiagnostics(profileId: string, apiType: ApiType): RuntimeProfileRuntimeDiagnostics;
}
