import type {
  PromptConfig,
  RegexScript,
  SamplerPreset,
} from "../../types";
import type { CompatibilityReport } from "../../domain/prompts/promptAssemblyTypes";
import type { CompatibilityCodecDefinition } from "../compatibility/contracts";
import {
  buildMobileTavernPresetExtension,
  MOBILE_TAVERN_PRESET_EXTENSION_KEY,
} from "./presetRuntimeNamespace";

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
  const traditionalPrompts = promptConfig.customPrompts ?? [];
  const promptData = {
    prompts: traditionalPrompts.map((prompt) => ({
      ...prompt,
      // 展开之后再兜底，避免显式 `identifier: undefined/null` 覆盖回退值。
      identifier: prompt.identifier || prompt.id,
    })),
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
        // ST 无法表达的运行期开关走 MT 命名空间，保证导出→导入不丢失预设语义。
        [MOBILE_TAVERN_PRESET_EXTENSION_KEY]: buildMobileTavernPresetExtension(promptConfig),
      },
    },
    report: { warnings: [], errors: [] },
  };
}
