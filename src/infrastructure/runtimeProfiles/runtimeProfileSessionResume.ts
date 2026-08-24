import { z } from "zod";

const STORAGE_KEY = "mobile-tavern.runtime-profile-session-resume.v1";
const RUNTIME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const resumeIntentSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1).max(256),
  characterId: z.string().min(1).max(256),
  profileId: z.string().regex(RUNTIME_ID_PATTERN),
  profileVersion: z.number().int().positive(),
});

export type RuntimeProfileSessionResumeIntent = z.infer<typeof resumeIntentSchema>;

export function readRuntimeProfileSessionResumeIntent(): RuntimeProfileSessionResumeIntent | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = resumeIntentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

export function writeRuntimeProfileSessionResumeIntent(
  intent: RuntimeProfileSessionResumeIntent,
): void {
  const parsed = resumeIntentSchema.parse(intent);
  if (typeof sessionStorage === "undefined") {
    throw new Error("RUNTIME_PROFILE_SESSION_STORAGE_UNAVAILABLE");
  }
  const serialized = JSON.stringify(parsed);
  sessionStorage.setItem(STORAGE_KEY, serialized);
  if (sessionStorage.getItem(STORAGE_KEY) !== serialized) {
    throw new Error("RUNTIME_PROFILE_SESSION_RESUME_INTENT_NOT_PERSISTED");
  }
}

export function clearRuntimeProfileSessionResumeIntent(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
}
