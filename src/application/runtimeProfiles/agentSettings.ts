import { z } from "zod";
import type { AgentCompositionSnapshot } from "../../domain/agents/contracts";
import type { RuntimeProfileAgentSettings } from "./contracts";

export const AGENT_PROFILE_SETTINGS_DECISION_ID = "agent.profile.settings";

const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

export const runtimeProfileToolMountSchema = z.object({
  name: z.string().regex(RUNTIME_ID_PATTERN),
  version: z.string().trim().min(1).max(64).optional(),
}).strict();

export const runtimeProfileSamplingSchema = z.object({
  temperature: z.number().finite().min(0).max(5),
  topP: z.number().finite().min(0).max(1),
  topK: z.number().int().min(0).max(1000),
  repetitionPenalty: z.number().finite().min(0).max(5),
  frequencyPenalty: z.number().finite().min(-2).max(2).optional(),
  presencePenalty: z.number().finite().min(-2).max(2).optional(),
  minP: z.number().finite().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().max(1_000_000),
}).strict();

export const runtimeProfileAgentSettingsSchema = z.object({
  characterId: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  toolMounts: z.array(runtimeProfileToolMountSchema).max(64),
  promptPresetId: z.string().regex(RUNTIME_ID_PATTERN).optional(),
  sampling: runtimeProfileSamplingSchema.optional(),
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

export function parseRuntimeProfileAgentSettings(input: unknown): RuntimeProfileAgentSettings {
  return runtimeProfileAgentSettingsSchema.parse(input);
}

/** 从会话不可变快照读取 Agent 行为；旧会话没有该决策时保持原行为。 */
export function readAgentSettingsFromComposition(
  snapshot: AgentCompositionSnapshot | undefined,
): RuntimeProfileAgentSettings | undefined {
  const input = snapshot?.capabilityDecisions[AGENT_PROFILE_SETTINGS_DECISION_ID];
  if (input === undefined) return undefined;
  const parsed = runtimeProfileAgentSettingsSchema.safeParse(input);
  if (!parsed.success) throw new Error("AGENT_PROFILE_SESSION_SETTINGS_INVALID");
  return parsed.data;
}
