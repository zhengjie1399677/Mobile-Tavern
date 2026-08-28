import type {
  PresetPromptConfig,
  PromptConfig,
  PromptPresetPlan,
  PromptPresetPlanSource,
  SavedPresetBundle,
} from "../../types";
import { createBasicPromptComposition, parsePromptComposition } from "../../domain/prompt-composition";

/** 从完整设置中提取预设可拥有的传统 Prompt 字段。 */
export function toPresetPromptConfig(config: PromptConfig): PresetPromptConfig {
  const {
    composition: _composition,
    usePromptComposition: _usePromptComposition,
    ...presetPromptConfig
  } = config;
  return presetPromptConfig;
}

/** 应用预设字段并保留当前自由编排状态。 */
export function applyPresetPromptConfig(
  current: PromptConfig,
  stored: PresetPromptConfig,
): PromptConfig {
  return {
    ...current,
    ...toPresetPromptConfig(stored as PromptConfig),
    composition: current.composition,
    usePromptComposition: current.usePromptComposition,
  };
}

/**
 * 从当前设置创建预设拥有的权威 Prompt 快照。
 */
export function createPromptPresetPlan(
  config: PromptConfig,
  source: PromptPresetPlanSource = "mobile-tavern",
): PromptPresetPlan {
  return {
    version: 1,
    mode: config.usePromptComposition ? "composition" : "legacy",
    source,
    composition: config.composition,
  };
}

/**
 * 解析新旧预设包的 Prompt 快照。
 *
 * 无版本字段的旧 Mobile Tavern 预设明确降级为 legacy；不再继承当前预设的
 * `usePromptComposition`。旧版 `composition + usePromptComposition` 仍无损升级。
 */
export function resolvePromptPresetPlan(
  bundle: Pick<
    SavedPresetBundle,
    "promptConfig" | "promptPlan" | "composition" | "usePromptComposition"
  >,
): PromptPresetPlan {
  const explicit = parseStoredPromptPresetPlan(bundle.promptPlan);
  if (explicit) return explicit;

  const legacyComposition = parseStoredComposition(bundle.composition);
  const source = inferPlanSource(legacyComposition);
  if (bundle.usePromptComposition === true && legacyComposition) {
    return { version: 1, mode: "composition", source, composition: legacyComposition };
  }
  return {
    version: 1,
    mode: "legacy",
    source,
    composition: legacyComposition ?? createLegacyCompositionSnapshot(bundle.promptConfig),
  };
}

/** 将任意历史预设收口为带版本 Prompt 快照的新结构。 */
export function normalizeSavedPresetPromptPlan(bundle: SavedPresetBundle): SavedPresetBundle {
  const candidate = bundle as unknown as Record<string, unknown>;
  if (!candidate.promptConfig || typeof candidate.promptConfig !== "object" || Array.isArray(candidate.promptConfig)) {
    // 存储边界可能读到旧测试夹具或损坏记录；预设实体校验由上层导入用例负责，
    // 此处必须保持可读而不能因后台规范化让整个预设列表失效。
    return bundle;
  }
  const promptPlan = resolvePromptPresetPlan(bundle);
  const {
    composition: _legacyComposition,
    usePromptComposition: _legacyMode,
    ...currentBundle
  } = bundle;
  return {
    ...currentBundle,
    promptConfig: toPresetPromptConfig(bundle.promptConfig as PromptConfig),
    promptPlan,
  };
}

/** 应用预设 Prompt 快照；保留旧函数名作为现有调用方的兼容入口。 */
export function applyPresetCompositionToPromptConfig(
  current: PromptConfig,
  bundle: Pick<
    SavedPresetBundle,
    "promptConfig" | "promptPlan" | "composition" | "usePromptComposition"
  >,
): PromptConfig {
  const plan = resolvePromptPresetPlan(bundle);
  return {
    ...current,
    usePromptComposition: plan.mode === "composition",
    composition: plan.composition ?? current.composition,
  };
}

function parseStoredPromptPresetPlan(value: unknown): PromptPresetPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || (record.mode !== "legacy" && record.mode !== "composition")) return null;
  const composition = parseStoredComposition(record.composition);
  if (record.mode === "composition" && !composition) return null;
  const source = record.source === "sillytavern" || record.source === "native"
    ? record.source
    : "mobile-tavern";
  return { version: 1, mode: record.mode, source, composition };
}

function parseStoredComposition(value: unknown) {
  if (value === undefined) return undefined;
  try {
    return parsePromptComposition(value);
  } catch {
    return undefined;
  }
}

function inferPlanSource(composition: ReturnType<typeof parseStoredComposition>): PromptPresetPlanSource {
  return composition?.compatibility?.source === "sillytavern" ? "sillytavern" : "mobile-tavern";
}

function createLegacyCompositionSnapshot(config: PresetPromptConfig) {
  const composition = createBasicPromptComposition();
  const customBlocks = (config.customPrompts ?? []).map((prompt, index) => ({
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
  return {
    ...composition,
    id: `composition_legacy_${sanitizeBlockId(config.mainPrompt.slice(0, 24) || "preset")}`,
    name: "传统预设迁移快照",
    blocks: [
      ...composition.blocks.slice(0, 4),
      ...customBlocks,
      ...composition.blocks.slice(4),
    ],
    compatibility: { source: "mobile-tavern-legacy", sourceVersion: "1" },
  };
}

function sanitizeBlockId(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "preset";
}
