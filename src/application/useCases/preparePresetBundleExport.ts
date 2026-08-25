import type {
  PromptConfig,
  RegexScript,
  SamplerPreset,
} from "../../types";
import type { CompatibilityReport } from "../../domain/prompt-composition";
import type { CompatibilityCodecDefinition } from "../compatibility/contracts";

export interface PreparePresetBundleExportOptions {
  preset: SamplerPreset;
  promptConfig: PromptConfig;
  presetRegexScripts?: RegexScript[];
  compatibilityCodec?: CompatibilityCodecDefinition | null;
}

export interface PreparedPresetBundleExport {
  data: Record<string, unknown>;
  report: CompatibilityReport;
}

/** 将当前正式设置导出为 ST 可读取的预设；不会携带外部可执行脚本。 */
export function preparePresetBundleExport(
  options: PreparePresetBundleExportOptions,
): PreparedPresetBundleExport {
  const { preset, promptConfig } = options;
  const requiresCompatibilityCodec = Boolean(
    promptConfig.usePromptComposition && promptConfig.composition,
  );
  const compositionExport = promptConfig.usePromptComposition && promptConfig.composition
    ? parseCodecExport(options.compatibilityCodec?.encode(promptConfig.composition))
    : undefined;
  const traditionalPrompts = promptConfig.customPrompts ?? [];
  const promptData = compositionExport?.data ?? {
    prompts: traditionalPrompts.map((prompt) => ({ ...prompt })),
    prompt_order: [{
      character_id: 100001,
      order: traditionalPrompts.map((prompt) => ({
        identifier: prompt.identifier || prompt.id,
        enabled: prompt.enabled,
      })),
    }],
  };
  const shaping = promptConfig.requestShaping;

  return {
    data: {
      ...promptData,
      name: preset.name,
      temperature: preset.temperature,
      top_p: preset.topP,
      top_k: preset.topK,
      repetition_penalty: preset.repetitionPenalty,
      frequency_penalty: preset.frequencyPenalty ?? 0,
      presence_penalty: preset.presencePenalty ?? 0,
      min_p: preset.minP ?? 0,
      max_tokens: preset.maxTokens,
      system_prompt: promptConfig.mainPrompt,
      jailbreak_prompt: promptConfig.jailbreakPrompt,
      post_history_instructions: promptConfig.postHistoryPrompt,
      story_string: promptConfig.storyString,
      instruct_layouts: promptConfig.instructTemplate,
      system_sequence_start: promptConfig.systemPrefix,
      system_sequence_end: promptConfig.systemSuffix,
      user_sequence_start: promptConfig.userPrefix,
      user_sequence_end: promptConfig.userSuffix,
      assistant_sequence_start: promptConfig.assistantPrefix,
      assistant_sequence_end: promptConfig.assistantSuffix,
      assistant_prefill: shaping?.assistantPrefill,
      squash_system_messages: shaping?.squashSystemMessages === true,
      merge_adjacent_messages: shaping?.mergeAdjacentMessages === true,
      custom_stop_strings: shaping?.stopSequences ?? [],
      role_wrappers: shaping?.roleWrappers,
      // 显式覆盖兼容元数据里可能保留的 extensions，禁止重新导出外部脚本。
      extensions: {
        regex_scripts: options.presetRegexScripts ?? [],
      },
    },
    report: compositionExport?.report ?? (requiresCompatibilityCodec
      ? {
          warnings: [],
          errors: [{
            level: "error",
            code: "COMPATIBILITY_CODEC_UNAVAILABLE",
            message: "当前 Profile 未启用 SillyTavern 兼容 Codec，不能导出自由编排。",
          }],
        }
      : { warnings: [], errors: [] }),
  };
}

function parseCodecExport(value: unknown): {
  data: Record<string, unknown>;
  report: CompatibilityReport;
} | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_EXPORT_RESULT");
  }
  const result = value as Record<string, unknown>;
  if (
    !result.data
    || typeof result.data !== "object"
    || Array.isArray(result.data)
    || !result.report
    || typeof result.report !== "object"
    || Array.isArray(result.report)
  ) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_EXPORT_RESULT");
  }
  const report = result.report as Record<string, unknown>;
  if (!Array.isArray(report.warnings) || !Array.isArray(report.errors)) {
    throw new Error("COMPATIBILITY_CODEC_INVALID_EXPORT_RESULT");
  }
  return {
    data: result.data as Record<string, unknown>,
    report: report as unknown as CompatibilityReport,
  };
}
