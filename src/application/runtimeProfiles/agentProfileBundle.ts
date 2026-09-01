import { z } from "zod";
import type {
  RuntimeProfileCapabilities,
  RuntimeProfileSamplingSettings,
  RuntimeProfileToolMount,
} from "./contracts";

export const AGENT_PROFILE_BUNDLE_KIND = "mobile-tavern.agent-profile";
export const AGENT_PROFILE_BUNDLE_SCHEMA_VERSION = 1;

const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const resourceReferenceSchema = z.object({
  id: z.string().regex(RUNTIME_ID_PATTERN),
  name: z.string().trim().min(1).max(120),
}).strict();

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

const capabilitiesSchema = z.object({
  sillyTavernCompatibility: z.boolean(),
  audioAsrFallback: z.boolean(),
  videoKeyframeFallback: z.boolean(),
}).strict();

export const agentProfileBundleSchema = z.object({
  kind: z.literal(AGENT_PROFILE_BUNDLE_KIND),
  schemaVersion: z.literal(AGENT_PROFILE_BUNDLE_SCHEMA_VERSION),
  exportedAt: z.number().int().nonnegative(),
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    source: z.object({
      id: z.string().regex(RUNTIME_ID_PATTERN),
      version: z.number().int().positive(),
    }).strict(),
    capabilities: capabilitiesSchema,
    character: resourceReferenceSchema.optional(),
    tools: z.array(toolMountSchema).max(64),
    behavior: z.object({
      promptPreset: resourceReferenceSchema.optional(),
      sampling: samplingSchema.optional(),
    }).strict(),
  }).strict().superRefine((profile, context) => {
    const names = new Set<string>();
    profile.tools.forEach((tool, index) => {
      if (names.has(tool.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools", index, "name"],
          message: "duplicate tool mount",
        });
      }
      names.add(tool.name);
    });
  }),
}).strict();

export interface AgentProfileResourceReference {
  readonly id: string;
  readonly name: string;
}

export interface AgentProfileBundleV1 {
  readonly kind: typeof AGENT_PROFILE_BUNDLE_KIND;
  readonly schemaVersion: typeof AGENT_PROFILE_BUNDLE_SCHEMA_VERSION;
  readonly exportedAt: number;
  readonly profile: {
    readonly name: string;
    readonly source: {
      readonly id: string;
      readonly version: number;
    };
    readonly capabilities: RuntimeProfileCapabilities;
    readonly character?: AgentProfileResourceReference;
    readonly tools: readonly RuntimeProfileToolMount[];
    readonly behavior: {
      readonly promptPreset?: AgentProfileResourceReference;
      readonly sampling?: RuntimeProfileSamplingSettings;
    };
  };
}

export function parseAgentProfileBundle(input: unknown): AgentProfileBundleV1 {
  const parsed = agentProfileBundleSchema.safeParse(input);
  if (!parsed.success) throw new Error("AGENT_PROFILE_BUNDLE_INVALID");
  return parsed.data;
}
