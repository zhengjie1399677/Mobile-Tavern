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

const toolMountSchema = z.object({
  name: z.string().regex(RUNTIME_ID_PATTERN),
  version: z.string().trim().min(1).max(64).optional(),
}).strict();

const samplingSchema = z.object({
  temperature: z.number().finite().min(0).max(5),
  topP: z.number().finite().min(0).max(1),
  topK: z.number().int().min(0).max(1000),
  repetitionPenalty: z.number().finite().min(0).max(5),
  frequencyPenalty: z.number().finite().min(-2).max(2).optional(),
  presencePenalty: z.number().finite().min(-2).max(2).optional(),
  minP: z.number().finite().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().max(1_000_000),
}).strict();

const agentSchema = z.object({
  characterId: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  toolMounts: z.array(toolMountSchema).max(64),
  promptPresetId: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  sampling: samplingSchema.optional(),
}).strict().superRefine((agent, context) => {
  const names = new Set<string>();
  agent.toolMounts.forEach((tool, index) => {
    if (names.has(tool.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolMounts", index, "name"],
        message: "duplicate tool mount",
      });
    }
    names.add(tool.name);
  });
});

const profileSchema = z.object({
  id: z.string().regex(RUNTIME_ID_PATTERN),
  name: z.string().min(1).max(80),
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  builtin: z.literal(false),
  copiedFrom: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  capabilities: capabilitiesSchema,
  agent: agentSchema.optional(),
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
    agent: profile.agent ? Object.freeze({
      ...profile.agent,
      toolMounts: Object.freeze(profile.agent.toolMounts.map((tool) => Object.freeze({ ...tool }))),
      sampling: profile.agent.sampling
        ? Object.freeze({ ...profile.agent.sampling })
        : undefined,
    }) : undefined,
  }));
  return Object.freeze({
    schemaVersion: 1,
    selectedProfileId: value.selectedProfileId,
    customProfiles: Object.freeze(customProfiles),
  });
}
