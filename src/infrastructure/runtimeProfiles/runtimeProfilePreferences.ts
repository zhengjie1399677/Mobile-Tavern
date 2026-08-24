import { z } from "zod";
import {
  BUILTIN_TAVERN_PROFILE_ID,
  type RuntimeProfilePreferenceState,
  type RuntimeProfileRecord,
} from "../../application/runtimeProfiles/contracts";

const STORAGE_KEY = "mobile-tavern.runtime-profiles.v1";
const MAX_CUSTOM_PROFILES = 20;
const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const capabilitiesSchema = z.object({
  sillyTavernCompatibility: z.boolean(),
  audioAsrFallback: z.boolean(),
  videoKeyframeFallback: z.boolean(),
});

const profileSchema = z.object({
  id: z.string().regex(RUNTIME_ID_PATTERN),
  name: z.string().min(1).max(80),
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  builtin: z.literal(false),
  copiedFrom: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  capabilities: capabilitiesSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  selectedProfileId: z.string().regex(RUNTIME_ID_PATTERN),
  customProfiles: z.array(profileSchema).max(MAX_CUSTOM_PROFILES),
}).superRefine((state, context) => {
  const ids = new Set<string>();
  state.customProfiles.forEach((profile, index) => {
    if (ids.has(profile.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customProfiles", index, "id"],
        message: "duplicate runtime profile id",
      });
    }
    ids.add(profile.id);
  });
});

const DEFAULT_STATE: RuntimeProfilePreferenceState = Object.freeze({
  schemaVersion: 1,
  selectedProfileId: BUILTIN_TAVERN_PROFILE_ID,
  customProfiles: Object.freeze([]),
});

export interface RuntimeProfilePreferenceReadResult {
  readonly state: RuntimeProfilePreferenceState;
  readonly invalidStoredValue: boolean;
}

export function readRuntimeProfilePreferences(): RuntimeProfilePreferenceReadResult {
  try {
    if (typeof localStorage === "undefined") {
      return { state: DEFAULT_STATE, invalidStoredValue: false };
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: DEFAULT_STATE, invalidStoredValue: false };
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { state: DEFAULT_STATE, invalidStoredValue: true };
    return {
      state: freezeState(parsed.data),
      invalidStoredValue: false,
    };
  } catch {
    return { state: DEFAULT_STATE, invalidStoredValue: true };
  }
}

export function writeRuntimeProfilePreferences(state: RuntimeProfilePreferenceState): void {
  const parsed = stateSchema.parse(state);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  }
}

export function clearRuntimeProfilePreferencesForTests(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
}

function freezeState(value: z.infer<typeof stateSchema>): RuntimeProfilePreferenceState {
  const customProfiles: RuntimeProfileRecord[] = value.customProfiles.map((profile) => Object.freeze({
    ...profile,
    capabilities: Object.freeze({ ...profile.capabilities }),
  }));
  return Object.freeze({
    schemaVersion: 1,
    selectedProfileId: value.selectedProfileId,
    customProfiles: Object.freeze(customProfiles),
  });
}
