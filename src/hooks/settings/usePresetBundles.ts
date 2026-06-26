import React, { useCallback } from "react";
import { UserSettings, SamplerPreset } from "../../types";
import { saveStoredSavedPresets } from "../../utils/localDB";
import { DEFAULT_SETTINGS, DEFAULT_PRESETS, DEFAULT_PROMPT_CONFIG } from "./defaults";

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
  const handleImportPresetJSON = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);

        const name =
          data.name ||
          data.presetName ||
          data.title ||
          data.preset_name ||
          "导入自定义SillyTavern预设";

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

        const mainPrompt = data.system_prompt || data.mainPrompt || "";
        const jailbreakPrompt = data.jailbreak_prompt || data.jailbreakPrompt || "";
        const postHistoryPrompt =
          data.post_history_instructions || data.postHistoryPrompt || "";
        const storyStrFromJSON = data.story_string || data.storyString || "";
        const rawPrompts = data.prompts || data.customPrompts || [];
        const importedCustomPrompts = Array.isArray(rawPrompts)
          ? rawPrompts.map((p: any) => ({
              id: p.id || "import_comp_" + Math.random().toString(36).substring(2, 9),
              name: p.name || "导入提示词模组",
              role: p.role || "system",
              content: p.content || "",
              enabled: p.enabled !== false,
            }))
          : [];

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

        const systemPrefix =
          data.system_sequence_start || data.systemPrefix || "";
        const systemSuffix = data.system_sequence_end || data.systemSuffix || "";
        const userPrefix = data.user_sequence_start || data.userPrefix || "";
        const userSuffix = data.user_sequence_end || data.userSuffix || "";
        const assistantPrefix =
          data.assistant_sequence_start || data.assistantPrefix || "";
        const assistantSuffix =
          data.assistant_sequence_end || data.assistantSuffix || "";

        const hasPromptsArray = importedCustomPrompts.length > 0;
        const hasMainPromptText = !!mainPrompt;
        const hasAnyPromptFieldsInJSON =
          hasPromptsArray ||
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
        const importedRegexScripts: any[] = [];
        if (data.extensions && Array.isArray(data.extensions.regex_scripts)) {
          for (const item of data.extensions.regex_scripts) {
            if (item && typeof item === "object" && item.scriptName && item.findRegex) {
              importedRegexScripts.push({
                id: item.id || "import_reg_" + Math.random().toString(36).substring(2, 9),
                scriptName: item.scriptName,
                findRegex: item.findRegex,
                replaceString: typeof item.replaceString === "string" ? item.replaceString : "",
                disabled: item.disabled === true,
                placement: Array.isArray(item.placement) ? item.placement : [2],
                runOnEdit: item.runOnEdit ?? true,
                markdownOnly: item.markdownOnly ?? false,
                promptOnly: item.promptOnly ?? false,
              });
            }
          }
        }

        const nextSettings: UserSettings = {
          ...settings,
          preset: importedPreset,
          presetRegexScripts: importedRegexScripts,
          promptConfig: {
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
            customPrompts: finalCustomPrompts,
          },
        };

        let messageDetails = `采样器参数覆盖：温度 ${temp}, TopP ${topP}, 词重复惩罚 ${repPen}`;
        if (importedRegexScripts.length > 0) {
          messageDetails += `\n\n检测到预设专属正则脚本共 ${importedRegexScripts.length} 个。已随此预设一同保存并在激活此预设时生效。`;
        }

        updateSettings(nextSettings);
        showCustomAlert(
          `🎉 SillyTavern 级别系统预设包解析导入成功！\n[${name}]\n${messageDetails}`
        );
      } catch (err) {
        showCustomAlert("解析预设 JSON 配置文件失败，请确保格式正确");
      }
    };
    reader.readAsText(file);
  }, [settings, updateSettings, showCustomAlert]);

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
    if ((window as any).AndroidThemeBridge && typeof (window as any).AndroidThemeBridge.saveFile === "function") {
      const path = (window as any).AndroidThemeBridge.saveFile(fileName, content);
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
      promptConfig: { ...settings.promptConfig },
      presetRegexScripts: settings.presetRegexScripts ? [...settings.presetRegexScripts] : [],
    };

    const nextSaved = [...(settings.savedPresets || []), newBundle];
    const nextSettings = {
      ...settings,
      preset: newBundle.preset,
      promptConfig: newBundle.promptConfig,
      presetRegexScripts: newBundle.presetRegexScripts,
      savedPresets: nextSaved,
    };
    updateSettings(nextSettings);
    await saveStoredSavedPresets(nextSaved);
    await showCustomAlert(`成功保存新预设：${name}`);
  }, [settings, showCustomPrompt, updateSettings, showCustomAlert]);

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
      promptConfig: bundle.promptConfig,
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
      nextPromptConfig = nextSaved[0].promptConfig;
    } else {
      nextPreset = DEFAULT_PRESETS.balanced;
      nextPromptConfig = DEFAULT_PROMPT_CONFIG;
    }

    updateSettings({
      ...settings,
      preset: nextPreset,
      promptConfig: nextPromptConfig,
      savedPresets: nextSaved,
    });
    await saveStoredSavedPresets(nextSaved);
  }, [settings, showCustomConfirm, updateSettings]);

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
        nextPromptConfig = nextSaved[0].promptConfig;
        nextRegex = nextSaved[0].presetRegexScripts || [];
      } else {
        nextPreset = DEFAULT_PRESETS.balanced;
        nextPromptConfig = DEFAULT_PROMPT_CONFIG;
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
    await saveStoredSavedPresets(nextSaved);
    await showCustomAlert("🎉 批量删除成功！");
  }, [settings, showCustomConfirm, updateSettings, showCustomAlert]);

  return {
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
  };
};
