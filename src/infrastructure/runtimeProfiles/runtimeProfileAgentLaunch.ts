import { z } from "zod";

const STORAGE_KEY = "mobile-tavern.runtime-profile-agent-launch.v1";
const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const launchIntentSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().regex(RUNTIME_ID_PATTERN),
  profileVersion: z.number().int().positive(),
  characterId: z.string().regex(RUNTIME_ID_PATTERN),
}).strict();

export type RuntimeProfileAgentLaunchIntent = z.infer<typeof launchIntentSchema>;

export function readRuntimeProfileAgentLaunchIntent(): RuntimeProfileAgentLaunchIntent | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = launchIntentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

export function writeRuntimeProfileAgentLaunchIntent(
  intent: RuntimeProfileAgentLaunchIntent,
): void {
  const parsed = launchIntentSchema.parse(intent);
  if (typeof sessionStorage === "undefined") {
    throw new Error("RUNTIME_PROFILE_SESSION_STORAGE_UNAVAILABLE");
  }
  const serialized = JSON.stringify(parsed);
  sessionStorage.setItem(STORAGE_KEY, serialized);
  if (sessionStorage.getItem(STORAGE_KEY) !== serialized) {
    throw new Error("RUNTIME_PROFILE_AGENT_LAUNCH_INTENT_NOT_PERSISTED");
  }
}

export function clearRuntimeProfileAgentLaunchIntent(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
}
