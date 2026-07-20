import type {
  PromptComposition,
  PromptCompositionTemplateRecord,
  PromptCompositionTemplateSource,
} from "./types";

export function createPromptCompositionTemplateRecord(
  composition: PromptComposition,
  source: PromptCompositionTemplateSource,
  now = Date.now(),
): PromptCompositionTemplateRecord {
  return {
    id: `prompt_template_${source}_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: composition.name,
    source,
    createdAt: now,
    updatedAt: now,
    composition: structuredClone(composition),
  };
}
