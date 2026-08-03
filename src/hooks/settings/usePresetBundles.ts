import React, { useCallback } from "react";
import {
  UserSettings,
  SamplerPreset,
  SavedPresetBundle,
  PresetPromptConfig,
  RegexScript,
  CustomPromptBlock,
} from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import { IPresetService } from "@/src/application/serviceContracts";
import { DEFAULT_SETTINGS, DEFAULT_PROMPT_CONFIG } from "./defaults";
import { applyPresetPromptConfig, toPresetPromptConfig } from "./presetPromptConfig";
import {
  analyzeSillyTavernPreset,
  importSillyTavernPreset,
  type SillyTavernPresetAnalysis,
} from "../../infrastructure/compat/sillytavern";

/**
 * 微内核插件式架构：预设包持久化统一走 PresetService。
 * 业务层不再直接触碰 localDB，遵循 AGENTS.md 准则一与准则八。
 */

/**
 * 原生 Android WebView 注入的桥接对象形状（仅声明本文件实际使用的方法子集）。
 * 完整定义见 src-tauri/plugins/android-bridge/guest-js/index.ts。
 */
interface AndroidThemeBridge {
  saveFile?: (fileName: string, content: string) => string;
}

/**
 * 扩展 Window 以访问原生注入的 AndroidThemeBridge。
 * 字段可选，反映"运行时动态挂载到 window"的真实语义。
 */
interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

type ExternalRecord = Record<string, unknown>;

interface PromptOrderEntry {
  identifier: string;
  enabled: boolean;
}

const isRecord = (value: unknown): value is ExternalRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

/** ST 导出通常用 100001 保存用户实际编排，100000 是基础默认编排。 */
const readPreferredPromptOrder = (value: unknown): PromptOrderEntry[] => {
  if (!Array.isArray(value)) return [];
  const containers = value.filter(isRecord).filter((item) => Array.isArray(item.order));
  const selected = containers.find((item) => item.character_id === 100001 || item.character_id === "100001")
    ?? containers[0];
  if (!selected || !Array.isArray(selected.order)) return [];
  return selected.order.filter(isRecord).flatMap((item) => {
    const identifier = readString(item.identifier);
    return identifier ? [{ identifier, enabled: item.enabled !== false }] : [];
  });
};

const formatCompatibilityAnalysis = (analysis: SillyTavernPresetAnalysis): string => {
  const levelLabel = {
    full: "完整兼容",
    core: "核心兼容",
    recognize_only: "仅识别/降级导入",
    invalid: "无效格式",
  }[analysis.level];
  const scriptSize = analysis.tavernHelperScriptBytes >= 1024 * 1024
    ? `${(analysis.tavernHelperScriptBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(analysis.tavernHelperScriptBytes / 1024)} KB`;
  const details = [
    `兼容分级：${levelLabel}`,
    `Prompt：${analysis.enabledPromptCount}/${analysis.orderedPromptCount} 启用（共 ${analysis.promptCount} 项）`,
    `Marker：${analysis.markerCount}，In-Chat：${analysis.inChatPromptCount}，正则：${analysis.regexCount}`,
  ];
  if (analysis.tavernHelperScriptCount > 0) {
    details.push(
      `TavernHelper：${analysis.enabledTavernHelperScriptCount}/${analysis.tavernHelperScriptCount} 启用，脚本 ${scriptSize}`,
    );
  }
  if (analysis.remoteScriptCount > 0) details.push(`外部网络脚本：${analysis.remoteScriptCount} 个（不执行）`);
  if (analysis.attachmentPromptCount > 0) details.push(`降级：${analysis.attachmentPromptCount} 个数据库附着 Prompt 不执行附着语义`);
  if (analysis.unknownMarkerCount > 0) details.push(`降级：${analysis.unknownMarkerCount} 个未知 Marker`);
  return details.join("\n");
};


interface UsePresetBundlesDeps {
  settings: UserSettings;
  updateSettings: (
    updater: UserSettings | ((prev: UserSettings) => UserSettings)
  ) => void;
  showCustomAlert: (msg: string, title?: string) => Promise<void> | void;
  showCustomPrompt: (
    message: string,
    defaultValue?: string
  ) => Promise<string | null>;
  showCustomConfirm: (message: string) => Promise<boolean>;
}

interface UsePresetBundlesReturn {
  handleImportPresetJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPresetJSON: () => void;
  handleSaveNewPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => void;
  handleDeletePresetBundle: (presetId: string) => Promise<void>;
  handleDeletePresetBundles: (bundleIds: string[]) => Promise<void>;
}

/**
 * 预设包管理子 Hook。
 *
 * 负责 SillyTavern 级别系统预设包的导入、导出、保存、加载与删除（含单个与批量）。
 */
export const usePresetBundles = ({
  settings,
  updateSettings,
  showCustomAlert,
  showCustomPrompt,
  showCustomConfirm,
}: UsePresetBundlesDeps): UsePresetBundlesReturn => {
  const kernel = useKernel();
  const presetService = kernel.getService<IPresetService<SavedPresetBundle>>("preset");

  const handleImportPresetJSON = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.target;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed: unknown = JSON.parse(event.target?.result as string);
        if (!isRecord(parsed)) throw new Error("PRESET_INVALID_ROOT");
        const data = parsed;

        // 名称优先级：JSON 内 name 字段 > 文件名（去掉 .json 后缀）
        // SillyTavern 预设 JSON 通常不含 name 字段，名称存于文件名
        const fileNameWithoutExt = file.name.replace(/\.json$/i, "");
        const name: string =
          (typeof data.name === "string" && data.name) ||
          (typeof data.preset_name === "string" && data.preset_name) ||
          (typeof data.presetName === "string" && data.presetName) ||
          fileNameWithoutExt;

        const temp =
          typeof data.temperature === "number"
            ? data.temperature
            : typeof data.temp === "number"
              ? data.temp
              : 0.8;
        const topP =
          typeof data.top_p === "number"
            ? data.top_p
            : typeof data.topP === "number"
              ? data.topP
              : 0.85;
        const topK =
          typeof data.top_k === "number"
            ? data.top_k
            : typeof data.topK === "number"
              ? data.topK
              : 40;
        const repPen =
          typeof data.repetition_penalty === "number"
            ? data.repetition_penalty
            : typeof data.repetitionPenalty === "number"
              ? data.repetitionPenalty
              : 1.05;
        const freqPen =
          typeof data.frequency_penalty === "number"
            ? data.frequency_penalty
            : typeof data.frequencyPenalty === "number"
              ? data.frequencyPenalty
              : 0.0;
        const presPen =
          typeof data.presence_penalty === "number"
            ? data.presence_penalty
            : typeof data.presencePenalty === "number"
              ? data.presencePenalty
              : 0.0;
        const minP =
          typeof data.min_p === "number"
            ? data.min_p
            : typeof data.minP === "number"
              ? data.minP
              : 0.0;
        const maxTok =
          typeof data.max_tokens === "number"
            ? data.max_tokens
            : typeof data.openai_max_tokens === "number"
              ? data.openai_max_tokens
              : typeof data.maxTokens === "number"
                ? data.maxTokens
                : 600;

        const importedPreset: SamplerPreset = {
          id: "import_" + Math.random().toString(36).substring(2, 9),
          name,
          temperature: temp,
          topP,
          topK,
          repetitionPenalty: repPen,
          frequencyPenalty: freqPen,
          presencePenalty: presPen,
          minP,
          maxTokens: maxTok,
        };

        const mainPrompt = readString(data.system_prompt) ?? readString(data.mainPrompt) ?? "";
        const jailbreakPrompt = readString(data.jailbreak_prompt) ?? readString(data.jailbreakPrompt) ?? "";
        const postHistoryPrompt =
          readString(data.post_history_instructions) ?? readString(data.postHistoryPrompt) ?? "";
        const storyStrFromJSON = readString(data.story_string) ?? readString(data.storyString) ?? "";
        const rawPrompts = Array.isArray(data.prompts)
          ? data.prompts
          : Array.isArray(data.customPrompts) ? data.customPrompts : [];
        const promptRecords = rawPrompts.filter(isRecord);
        const preferredOrder = readPreferredPromptOrder(data.prompt_order ?? data.promptOrder);
        const orderByIdentifier = new Map(preferredOrder.map((item) => [item.identifier, item]));
        const promptByIdentifier = new Map(promptRecords.map((prompt, index) => [
          readString(prompt.identifier) ?? readString(prompt.id) ?? `prompt_${index + 1}`,
          prompt,
        ]));
        const orderedIdentifiers = [
          ...preferredOrder.map((item) => item.identifier),
          ...[...promptByIdentifier.keys()].filter((identifier) => !orderByIdentifier.has(identifier)),
        ];
        const importedCustomPrompts: CustomPromptBlock[] = orderedIdentifiers.map((identifier) => {
          const prompt = promptByIdentifier.get(identifier) ?? {};
          const rawRole = readString(prompt.role);
          const role: CustomPromptBlock["role"] = rawRole === "user" || rawRole === "assistant"
            ? rawRole
            : "system";
          const orderEntry = orderByIdentifier.get(identifier);
          return {
            id: readString(prompt.id) ?? identifier,
            identifier,
            name: readString(prompt.name) ?? "导入提示词模组",
            role,
            content: readString(prompt.content) ?? "",
            enabled: orderEntry?.enabled ?? (preferredOrder.length > 0 ? false : prompt.enabled !== false),
            marker: prompt.marker === true || undefined,
            system_prompt: typeof prompt.system_prompt === "boolean" ? prompt.system_prompt : undefined,
            injection_position: readNumber(prompt.injection_position),
            injection_depth: readNumber(prompt.injection_depth),
            injection_order: readNumber(prompt.injection_order),
            forbid_overrides: typeof prompt.forbid_overrides === "boolean" ? prompt.forbid_overrides : undefined,
            injection_trigger: readStringArray(prompt.injection_trigger),
          };
        });

        const stInstructLayout = data.instruct_layouts || data.instructTemplate || "default";
        let instructTemplate: "default" | "alpaca" | "chatml" | "llama3" | "custom" = "default";
        if (
          stInstructLayout === "default" ||
          stInstructLayout === "alpaca" ||
          stInstructLayout === "chatml" ||
          stInstructLayout === "llama3" ||
          stInstructLayout === "custom"
        ) {
          instructTemplate = stInstructLayout;
        }

        const systemPrefix = readString(data.system_sequence_start) ?? readString(data.systemPrefix) ?? "";
        const systemSuffix = readString(data.system_sequence_end) ?? readString(data.systemSuffix) ?? "";
        const userPrefix = readString(data.user_sequence_start) ?? readString(data.userPrefix) ?? "";
        const userSuffix = readString(data.user_sequence_end) ?? readString(data.userSuffix) ?? "";
        const assistantPrefix = readString(data.assistant_sequence_start) ?? readString(data.assistantPrefix) ?? "";
        const assistantSuffix = readString(data.assistant_sequence_end) ?? readString(data.assistantSuffix) ?? "";
        const assistantPrefill = readString(data.assistant_prefill) ?? "";
        const importedStopSequences = readStringArray(data.custom_stop_strings)
          ?? readStringArray(data.stop_sequences)
          ?? [];
        const squashSystemMessages = data.squash_system_messages === true;
        const hasImportedRequestShaping = !!assistantPrefill
          || importedStopSequences.length > 0
          || squashSystemMessages;

        const hasPromptsArray = importedCustomPrompts.length > 0;
        const hasMainPromptText = !!mainPrompt;
        const hasAnyPromptFieldsInJSON =
          hasPromptsArray ||
          Array.isArray(data.prompt_order) ||
          Array.isArray(data.promptOrder) ||
          hasMainPromptText ||
          !!jailbreakPrompt ||
          !!postHistoryPrompt ||
          !!storyStrFromJSON;

        let finalMainPrompt = settings.promptConfig.mainPrompt;
        let finalJailbreakPrompt = settings.promptConfig.jailbreakPrompt;
        let finalUseJailbreak = settings.promptConfig.useJailbreak;
        let finalPostHistoryPrompt = settings.promptConfig.postHistoryPrompt;
        let finalUsePostHistory = settings.promptConfig.usePostHistory;
        let finalStoryString = settings.promptConfig.storyString;
        let finalCustomPrompts = settings.promptConfig.customPrompts;
        if (hasAnyPromptFieldsInJSON) {
          finalMainPrompt = mainPrompt;
          finalJailbreakPrompt = jailbreakPrompt;
          finalUseJailbreak = !!jailbreakPrompt;
          finalPostHistoryPrompt = postHistoryPrompt;
          finalUsePostHistory = !!postHistoryPrompt;
          finalStoryString = storyStrFromJSON || "";
          finalCustomPrompts = importedCustomPrompts;
        }

        // 解析预设全局正则脚本
        const importedRegexScripts: RegexScript[] = [];
        const extensions = isRecord(data.extensions) ? data.extensions : undefined;
        if (extensions && Array.isArray(extensions.regex_scripts)) {
          for (const item of extensions.regex_scripts) {
            if (isRecord(item) && readString(item.scriptName) && readString(item.findRegex)) {
              importedRegexScripts.push({
                id: readString(item.id) ?? "import_reg_" + Math.random().toString(36).substring(2, 9),
                scriptName: readString(item.scriptName)!,
                findRegex: readString(item.findRegex)!,
                replaceString: typeof item.replaceString === "string" ? item.replaceString : "",
                disabled: item.disabled === true,
                placement: Array.isArray(item.placement)
                  ? item.placement.filter((entry): entry is number => typeof entry === "number")
                  : [2],
                runOnEdit: typeof item.runOnEdit === "boolean" ? item.runOnEdit : true,
                markdownOnly: typeof item.markdownOnly === "boolean" ? item.markdownOnly : false,
                promptOnly: typeof item.promptOnly === "boolean" ? item.promptOnly : false,
                substituteRegex: readNumber(item.substituteRegex),
                minDepth: item.minDepth === null ? null : readNumber(item.minDepth),
                maxDepth: item.maxDepth === null ? null : readNumber(item.maxDepth),
                trimStrings: readStringArray(item.trimStrings),
              });
            }
          }
        }

        const importedPromptConfig: PresetPromptConfig = toPresetPromptConfig({
          ...settings.promptConfig,
          mainPrompt: finalMainPrompt,
          jailbreakPrompt: finalJailbreakPrompt,
          useJailbreak: finalUseJailbreak,
          postHistoryPrompt: finalPostHistoryPrompt,
          usePostHistory: finalUsePostHistory,
          storyString: finalStoryString,
          instructTemplate: instructTemplate,
          systemPrefix: systemPrefix || settings.promptConfig.systemPrefix,
          systemSuffix: systemSuffix || settings.promptConfig.systemSuffix,
          userPrefix: userPrefix || settings.promptConfig.userPrefix,
          userSuffix: userSuffix || settings.promptConfig.userSuffix,
          assistantPrefix:
            assistantPrefix || settings.promptConfig.assistantPrefix,
          assistantSuffix:
            assistantSuffix || settings.promptConfig.assistantSuffix,
          requestShaping: hasImportedRequestShaping
            ? {
                enabled: true,
                mergeAdjacentMessages: false,
                squashSystemMessages,
                assistantPrefill,
                stopSequences: importedStopSequences,
              }
            : settings.promptConfig.requestShaping,
          customPrompts: finalCustomPrompts,
        });
        const isSillyTavernPromptPreset = Array.isArray(data.prompts)
          && (Array.isArray(data.prompt_order) || Array.isArray(data.promptOrder));
        const importedComposition = isSillyTavernPromptPreset
          ? {
              ...importSillyTavernPreset({ ...data, name }).composition,
              name,
            }
          : undefined;
        const compatibilityAnalysis = isSillyTavernPromptPreset
          ? analyzeSillyTavernPreset(data)
          : undefined;
        const enableImportedComposition = importedComposition
          ? await showCustomConfirm(
              `检测到 SillyTavern Prompt 编排。\n\n${compatibilityAnalysis ? formatCompatibilityAnalysis(compatibilityAnalysis) : ""}\n\n是否启用自由编排以完整保留 Prompt 顺序、Marker 和注入位置？\n\n选择取消仍会导入传统预设，不会修改当前自由编排。`,
            )
          : false;
        const importedBundle = {
          id: "bundle_" + Math.random().toString(36).substring(2, 9),
          preset: importedPreset,
          promptConfig: importedPromptConfig,
          presetRegexScripts: importedRegexScripts,
        };

        // 从 DB 读取当前 savedPresets 作为基准（避免陈旧闭包导致 savedPresets 被回退）
        // DB 是 savedPresets 的单一事实来源，React state 的 savedPresets 仅在挂载时从 DB 加载
        const currentSavedFromDB = (await presetService.getStoredSavedPresets()) || [];
        const nextSaved = [...currentSavedFromDB, importedBundle];

        // 使用函数式 updater 确保基于最新 prev 状态合并，避免对象式 updater
        // 在陈旧闭包场景下错误回退 savedPresets（根因：getNestedDelta 对象式 delta 提取缺陷）
        updateSettings((prev) => {
          const promptConfig = applyPresetPromptConfig(prev.promptConfig, importedPromptConfig);
          return {
            ...prev,
            preset: importedPreset,
            presetRegexScripts: importedRegexScripts,
            savedPresets: nextSaved,
            promptConfig: enableImportedComposition && importedComposition
              ? { ...promptConfig, usePromptComposition: true, composition: importedComposition }
              : promptConfig,
          };
        });
        try {
          await presetService.saveStoredSavedPresets(nextSaved);
        } catch (saveErr) {
          throw saveErr;
        }
        await showCustomAlert(`预设已导入\n[${name}]`);
      } catch (err) {
        await showCustomAlert("解析或保存预设 JSON 配置文件失败，请确保格式正确");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }, [settings, updateSettings, showCustomAlert, showCustomConfirm, presetService]);

  const handleExportPresetJSON = useCallback(() => {
    const bundleData = {
      name: settings.preset.name,
      temperature: settings.preset.temperature,
      top_p: settings.preset.topP,
      top_k: settings.preset.topK,
      repetition_penalty: settings.preset.repetitionPenalty,
      frequency_penalty: settings.preset.frequencyPenalty || 0.0,
      presence_penalty: settings.preset.presencePenalty || 0.0,
      min_p: settings.preset.minP || 0.0,
      max_tokens: settings.preset.maxTokens,

      system_prompt: settings.promptConfig.mainPrompt,
      jailbreak_prompt: settings.promptConfig.jailbreakPrompt,
      post_history_instructions: settings.promptConfig.postHistoryPrompt,
      story_string: settings.promptConfig.storyString,
      prompts: settings.promptConfig.customPrompts || [],

      instruct_layouts: settings.promptConfig.instructTemplate,
      system_sequence_start: settings.promptConfig.systemPrefix,
      system_sequence_end: settings.promptConfig.systemSuffix,
      user_sequence_start: settings.promptConfig.userPrefix,
      user_sequence_end: settings.promptConfig.userSuffix,
      assistant_sequence_start: settings.promptConfig.assistantPrefix,
      assistant_sequence_end: settings.promptConfig.assistantSuffix,
      extensions: {
        regex_scripts: settings.presetRegexScripts || [],
      },
    };

    const content = JSON.stringify(bundleData, null, 2);
    const fileName = `SillyTavern_${settings.preset.name.replace(/\s+/g, "_")}_profile.json`;
    // If running in Android app via bridge
    if ((window as WindowWithAndroidBridge).AndroidThemeBridge && typeof (window as WindowWithAndroidBridge).AndroidThemeBridge?.saveFile === "function") {
      const path = (window as WindowWithAndroidBridge).AndroidThemeBridge!.saveFile!(fileName, content);
      if (path && !path.startsWith("error:")) {
        showCustomAlert(`📂 预设配置导出成功！\n文件已保存至手机 /Download 公共文件夹下，绝对路径为：\n${path}`);
      } else {
        showCustomAlert(`❌ 导出失败：${path || "未知错误"}`);
      }
      return;
    }

    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(content);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showCustomAlert(`📂 预设配置导出成功！\n文件已触发下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${fileName}`);
  }, [settings, showCustomAlert]);

  const handleSaveNewPresetBundle = useCallback(async () => {
    const name = await showCustomPrompt(
      "请输入新预设的名称",
      settings.preset.name + " 的副本",
    );
    if (!name) return;

    const newBundle = {
      id: "bundle_" + Math.random().toString(36).substring(2, 9),
      preset: {
        ...settings.preset,
        id: "preset_" + Math.random().toString(36).substring(2, 9),
        name,
      },
      promptConfig: toPresetPromptConfig(settings.promptConfig),
      presetRegexScripts: settings.presetRegexScripts ? [...settings.presetRegexScripts] : [],
    };

    const nextSaved = [...(settings.savedPresets || []), newBundle];
    const nextSettings = {
      ...settings,
      preset: newBundle.preset,
      promptConfig: applyPresetPromptConfig(settings.promptConfig, newBundle.promptConfig),
      presetRegexScripts: newBundle.presetRegexScripts,
      savedPresets: nextSaved,
    };
    updateSettings(nextSettings);
    await presetService.saveStoredSavedPresets(nextSaved);
    await showCustomAlert(`成功保存新预设：${name}`);
  }, [settings, showCustomPrompt, updateSettings, showCustomAlert, presetService]);

  const handleLoadPresetBundle = useCallback((bundleId: string) => {
    const bundle = (settings.savedPresets || []).find((b) => b.id === bundleId);
    if (!bundle) return;

    const mergedPreset = {
      ...DEFAULT_SETTINGS.preset,
      ...bundle.preset,
    };

    updateSettings({
      ...settings,
      preset: mergedPreset,
      promptConfig: applyPresetPromptConfig(settings.promptConfig, bundle.promptConfig),
      presetRegexScripts: bundle.presetRegexScripts || [],
    });
  }, [settings, updateSettings]);

  const handleDeletePresetBundle = useCallback(async (presetId: string) => {
    const bundleId = (settings.savedPresets || []).find(
      (b) => b.preset.id === presetId,
    )?.id;
    if (!bundleId) return;

    const ok = await showCustomConfirm("确定要删除这个本地保存的预设吗？");
    if (!ok) return;

    const nextSaved = (settings.savedPresets || []).filter(
      (b) => b.id !== bundleId,
    );

    let nextPreset = settings.preset;
    let nextPromptConfig = settings.promptConfig;
    if (nextSaved.length > 0) {
      nextPreset = nextSaved[0].preset;
      nextPromptConfig = applyPresetPromptConfig(settings.promptConfig, nextSaved[0].promptConfig);
    } else {
      nextPreset = DEFAULT_SETTINGS.preset;
      nextPromptConfig = applyPresetPromptConfig(
        settings.promptConfig,
        toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
      );
    }

    updateSettings({
      ...settings,
      preset: nextPreset,
      promptConfig: nextPromptConfig,
      savedPresets: nextSaved,
    });
    await presetService.saveStoredSavedPresets(nextSaved);
  }, [settings, showCustomConfirm, updateSettings, presetService]);

  const handleDeletePresetBundles = useCallback(async (bundleIds: string[]) => {
    if (!bundleIds || bundleIds.length === 0) return;

    const ok = await showCustomConfirm(`确定要批量删除这 ${bundleIds.length} 个本地预设包吗？`);
    if (!ok) return;

    const nextSaved = (settings.savedPresets || []).filter(
      (b) => !bundleIds.includes(b.id),
    );

    let nextPreset = settings.preset;
    let nextPromptConfig = settings.promptConfig;
    let nextRegex = settings.presetRegexScripts;

    const isCurrentDeleted = bundleIds.includes(settings.preset.id) ||
      (settings.savedPresets || []).some(b => b.preset.id === settings.preset.id && bundleIds.includes(b.id));

    if (isCurrentDeleted) {
      if (nextSaved.length > 0) {
        nextPreset = nextSaved[0].preset;
        nextPromptConfig = applyPresetPromptConfig(settings.promptConfig, nextSaved[0].promptConfig);
        nextRegex = nextSaved[0].presetRegexScripts || [];
      } else {
        nextPreset = DEFAULT_SETTINGS.preset;
        nextPromptConfig = applyPresetPromptConfig(
          settings.promptConfig,
          toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
        );
        nextRegex = [];
      }
    }

    updateSettings({
      ...settings,
      preset: nextPreset,
      promptConfig: nextPromptConfig,
      presetRegexScripts: nextRegex,
      savedPresets: nextSaved,
    });
    await presetService.saveStoredSavedPresets(nextSaved);
    await showCustomAlert("🎉 批量删除成功！");
  }, [settings, showCustomConfirm, updateSettings, showCustomAlert, presetService]);

  return {
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
  };
};
