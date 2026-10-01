import { createBasicPromptComposition, parsePromptComposition } from "../prompt-composition";
import type { PromptComposition } from "../prompt-composition";
import type { PresetPromptConfig } from "../../types";
import {
  PRESET_BUNDLE_SCHEMA_VERSION,
  type PresetPromptSnapshotV2,
} from "./contracts";

/**
 * 预设 Prompt 快照的领域规则。
 *
 * 这里同时服务两件事：
 * 1. v1 预设（`promptPlan` + 废弃的 `composition`/`usePromptComposition`）的读取降级；
 * 2. 把传统 Prompt 字段合成为「传统预设迁移快照」，使 legacy 预设也有中立编排可用。
 *
 * 逻辑此前散在 `application/useCases/presetPromptConfig.ts` 里；迁到领域层是为了让
 * v1→v2 迁移（领域）与运行期投影（应用）共用同一套规则，而不是各写一遍。
 */

export type PresetPromptMode = "legacy" | "composition";
export type PresetPromptSource = "mobile-tavern" | "sillytavern" | "native";

/** v1 预设中与 Prompt 相关的字段；全部按 `unknown` 读取，畸形数据必须能安全降级。 */
export interface PresetPromptV1Fields {
  promptConfig?: PresetPromptConfig | undefined;
  promptPlan?: unknown;
  composition?: unknown;
  usePromptComposition?: unknown;
}

/** 解析后的中立 Prompt 快照（不含版本号，由各层决定包成 v1 还是 v2）。 */
export interface ResolvedPresetPrompt {
  mode: PresetPromptMode;
  source: PresetPromptSource;
  composition: PromptComposition | undefined;
}

/**
 * 解析 v1 预设的 Prompt 快照。
 *
 * 无版本字段的旧预设明确降级为 legacy；不再继承当前设置的 `usePromptComposition`。
 * 旧版 `composition + usePromptComposition` 仍无损升级为自由编排。
 */
export function resolvePromptFromV1Fields(input: PresetPromptV1Fields): ResolvedPresetPrompt {
  const explicit = parseStoredPromptPlan(input.promptPlan);
  if (explicit) return explicit;

  const legacyComposition = parseStoredComposition(input.composition);
  const source = inferPlanSource(legacyComposition);
  if (input.usePromptComposition === true && legacyComposition) {
    return { mode: "composition", source, composition: legacyComposition };
  }
  return {
    mode: "legacy",
    source,
    composition: legacyComposition ?? createLegacyCompositionSnapshot(input.promptConfig),
  };
}

/** 包成 v2 实体使用的 Prompt 快照。 */
export function toPromptSnapshotV2(resolved: ResolvedPresetPrompt): PresetPromptSnapshotV2 {
  return {
    version: PRESET_BUNDLE_SCHEMA_VERSION,
    mode: resolved.mode,
    source: resolved.source,
    ...(resolved.composition === undefined ? {} : { composition: resolved.composition }),
  };
}

function parseStoredPromptPlan(value: unknown): ResolvedPresetPrompt | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 && value.version !== PRESET_BUNDLE_SCHEMA_VERSION) return null;
  if (value.mode !== "legacy" && value.mode !== "composition") return null;
  const composition = parseStoredComposition(value.composition);
  if (value.mode === "composition" && !composition) return null;
  const source: PresetPromptSource = value.source === "sillytavern" || value.source === "native"
    ? value.source
    : "mobile-tavern";
  return { mode: value.mode, source, composition };
}

function parseStoredComposition(value: unknown): PromptComposition | undefined {
  if (value === undefined) return undefined;
  try {
    return parsePromptComposition(value);
  } catch {
    return undefined;
  }
}

function inferPlanSource(composition: PromptComposition | undefined): PresetPromptSource {
  return composition?.compatibility?.source === "sillytavern" ? "sillytavern" : "mobile-tavern";
}

/**
 * 把传统 Prompt 字段合成为中立编排快照。
 *
 * 传统字段（主提示词、越狱、区块、故事串）没有区块级顺序信息，因此以出厂基础编排为骨架，
 * 把传统区块插到第 5 位起，并打上 `mobile-tavern-legacy` 来源标记供诊断与往返使用。
 */
export function createLegacyCompositionSnapshot(config: PresetPromptConfig | undefined): PromptComposition {
  const composition = createBasicPromptComposition();
  const customBlocks = (config?.customPrompts ?? []).map((prompt, index) => ({
    id: `legacy_custom_${index + 1}_${sanitizeBlockId(prompt.identifier || prompt.id || String(index + 1))}`,
    name: prompt.name || `传统 Prompt ${index + 1}`,
    enabled: prompt.enabled,
    role: prompt.role === "assistant" || prompt.role === "user" ? prompt.role : "system" as const,
    source: { type: "template" as const },
    template: prompt.content,
    order: 450 + index,
    placement: { type: "ordered" as const },
    compatibility: {
      source: "mobile-tavern-legacy",
      originalIdentifier: prompt.identifier || prompt.id,
    },
  }));
  const rawMainPrompt = (config as { mainPrompt?: unknown })?.mainPrompt;
  const legacyMainPrompt = typeof rawMainPrompt === "string" ? rawMainPrompt : "";
  return {
    ...composition,
    id: `composition_legacy_${sanitizeBlockId(legacyMainPrompt.slice(0, 24) || "preset")}`,
    name: "传统预设迁移快照",
    blocks: [
      ...composition.blocks.slice(0, 4),
      ...customBlocks,
      ...composition.blocks.slice(4),
    ],
    compatibility: { source: "mobile-tavern-legacy", sourceVersion: "1" },
  };
}

export function sanitizeBlockId(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "preset";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
