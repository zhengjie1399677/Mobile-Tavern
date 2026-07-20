import type { PromptComposition } from "../../domain/prompt-composition";
import { parsePromptComposition } from "../../domain/prompt-composition";

export const PROMPT_COMPOSITION_TEMPLATE_FORMAT = "mobile-tavern.prompt-composition";
export const PROMPT_COMPOSITION_TEMPLATE_VERSION = 1;
export const MAX_PROMPT_COMPOSITION_FILE_SIZE = 25 * 1024 * 1024;

interface PromptCompositionTemplateEnvelope {
  format: typeof PROMPT_COMPOSITION_TEMPLATE_FORMAT;
  version: typeof PROMPT_COMPOSITION_TEMPLATE_VERSION;
  exportedAt: string;
  composition: PromptComposition;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function serializePromptCompositionTemplate(
  composition: PromptComposition,
  exportedAt = new Date().toISOString(),
): string {
  const envelope: PromptCompositionTemplateEnvelope = {
    format: PROMPT_COMPOSITION_TEMPLATE_FORMAT,
    version: PROMPT_COMPOSITION_TEMPLATE_VERSION,
    exportedAt,
    composition: parsePromptComposition(composition),
  };
  return JSON.stringify(envelope, null, 2);
}

/** 支持当前版本化模板，同时兼容首期直接导出的裸 PromptComposition。 */
export function parsePromptCompositionTemplate(input: string): PromptComposition {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("PROMPT_COMPOSITION_INVALID_JSON");
  }

  if (isRecord(value) && value.format === PROMPT_COMPOSITION_TEMPLATE_FORMAT) {
    if (value.version !== PROMPT_COMPOSITION_TEMPLATE_VERSION) {
      throw new Error("PROMPT_COMPOSITION_TEMPLATE_UNSUPPORTED_VERSION");
    }
    return parsePromptComposition(value.composition);
  }
  return parsePromptComposition(value);
}

export function createPromptCompositionFileName(name: string): string {
  const safeName = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "prompt-composition";
  return `${safeName}.prompt-composition.json`;
}
