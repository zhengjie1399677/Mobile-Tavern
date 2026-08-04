import React, { useCallback } from "react";
import type { SavedPresetBundle, UserSettings } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import type { IPresetService } from "@/src/application/serviceContracts";
import {
  formatPresetOperationReport,
  formatSillyTavernCompatibilityAnalysis,
  preparePresetBundleImport,
} from "../../application/useCases/preparePresetBundleImport";
import { preparePresetBundleExport } from "../../application/useCases/preparePresetBundleExport";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "./defaults";
import { applyPresetCompositionToPromptConfig, applyPresetPromptConfig, toPresetPromptConfig } from "./presetPromptConfig";

/**
 * 微内核插件式架构：预设包持久化统一走 PresetService。
 * 业务层不再直接触碰 localDB。
 */

interface AndroidThemeBridge {
  saveFile?: (fileName: string, content: string) => string;
}

interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

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

/** 预设包管理子 Hook：只负责文件交互、用户确认、状态应用与持久化。 */
export const usePresetBundles = ({
  settings,
  updateSettings,
  showCustomAlert,
  showCustomPrompt,
  showCustomConfirm,
}: UsePresetBundlesDeps): UsePresetBundlesReturn => {
  const kernel = useKernel();
  const presetService = kernel.getService<IPresetService<SavedPresetBundle>>("preset");

  const handleImportPresetJSON = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.target;
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const parsed: unknown = JSON.parse(loadEvent.target?.result as string);
        const prepared = preparePresetBundleImport({
          input: parsed,
          fallbackName: file.name.replace(/\.json$/i, ""),
          currentPromptConfig: settings.promptConfig,
        });
        const importedComposition = prepared.composition;
        const importReportText = formatPresetOperationReport(prepared.report);
        if (prepared.report.errors.length > 0) throw new Error("PRESET_IMPORT_REPORT_HAS_ERRORS");
        const enableImportedComposition = importedComposition
          ? await showCustomConfirm(
              `检测到 SillyTavern Prompt 编排。\n\n${prepared.compatibilityAnalysis
                ? formatSillyTavernCompatibilityAnalysis(prepared.compatibilityAnalysis)
                : ""}${importReportText ? `\n\n${importReportText}` : ""}\n\n是否启用自由编排以完整保留 Prompt 顺序、Marker 和注入位置？\n\n选择取消仍会导入传统预设，不会修改当前自由编排。`,
            )
          : false;
        // 规划属于预设：导入的编排快照与开关随预设包一起保存，切换预设时整体切换。
        const importedBundle: SavedPresetBundle = {
          ...prepared.bundle,
          composition: importedComposition,
          usePromptComposition: enableImportedComposition,
        };
        const importedRegexScripts = importedBundle.presetRegexScripts ?? [];

        // DB 是 savedPresets 的单一事实来源，避免陈旧闭包回退已保存预设。
        const currentSavedFromDB = (await presetService.getStoredSavedPresets()) || [];
        const nextSaved = [...currentSavedFromDB, importedBundle];
        updateSettings((prev) => {
          const promptConfig = applyPresetPromptConfig(
            prev.promptConfig,
            importedBundle.promptConfig,
          );
          const appliedPromptConfig = applyPresetCompositionToPromptConfig(
            promptConfig,
            importedBundle,
          );
          return {
            ...prev,
            preset: importedBundle.preset,
            presetRegexScripts: importedRegexScripts,
            savedPresets: nextSaved,
            promptConfig: appliedPromptConfig,
          };
        });
        await presetService.saveStoredSavedPresets(nextSaved);
        await showCustomAlert(
          `预设已导入\n[${prepared.name}]${importReportText ? `\n\n${importReportText}` : ""}`,
        );
      } catch {
        await showCustomAlert("解析或保存预设 JSON 配置文件失败，请确保格式正确");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }, [settings.promptConfig, updateSettings, showCustomAlert, showCustomConfirm, presetService]);

  const handleExportPresetJSON = useCallback(() => {
    const prepared = preparePresetBundleExport({
      preset: settings.preset,
      promptConfig: settings.promptConfig,
      presetRegexScripts: settings.presetRegexScripts,
    });
    const reportText = formatPresetOperationReport(prepared.report, "导出");
    if (prepared.report.errors.length > 0) {
      showCustomAlert(`预设导出失败。\n\n${reportText}`);
      return;
    }
    const content = JSON.stringify(prepared.data, null, 2);
    const fileName = `SillyTavern_${settings.preset.name.replace(/\s+/g, "_")}_profile.json`;
    const androidBridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (androidBridge && typeof androidBridge.saveFile === "function") {
      const path = androidBridge.saveFile(fileName, content);
      if (path && !path.startsWith("error:")) {
        showCustomAlert(`📂 预设配置导出成功！\n文件已保存至手机 /Download 公共文件夹下，绝对路径为：\n${path}${reportText ? `\n\n${reportText}` : ""}`);
      } else {
        showCustomAlert(`❌ 导出失败：${path || "未知错误"}`);
      }
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(content);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showCustomAlert(`📂 预设配置导出成功！\n文件已触发下载，请前往您的系统“下载 (Downloads)”目录查找文件名：\n${fileName}${reportText ? `\n\n${reportText}` : ""}`);
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
      composition: settings.promptConfig.composition,
      usePromptComposition: settings.promptConfig.usePromptComposition ?? false,
      presetRegexScripts: settings.presetRegexScripts ? [...settings.presetRegexScripts] : [],
    };
    const nextSaved = [...(settings.savedPresets || []), newBundle];
    updateSettings({
      ...settings,
      preset: newBundle.preset,
      promptConfig: applyPresetPromptConfig(settings.promptConfig, newBundle.promptConfig),
      presetRegexScripts: newBundle.presetRegexScripts,
      savedPresets: nextSaved,
    });
    await presetService.saveStoredSavedPresets(nextSaved);
    await showCustomAlert(`成功保存新预设：${name}`);
  }, [settings, showCustomPrompt, updateSettings, showCustomAlert, presetService]);

  const handleLoadPresetBundle = useCallback((bundleId: string) => {
    const bundle = (settings.savedPresets || []).find((candidate) => candidate.id === bundleId);
    if (!bundle) return;
    const promptConfig = applyPresetCompositionToPromptConfig(
      applyPresetPromptConfig(settings.promptConfig, bundle.promptConfig),
      bundle,
    );
    updateSettings({
      ...settings,
      preset: { ...DEFAULT_SETTINGS.preset, ...bundle.preset },
      promptConfig,
      presetRegexScripts: bundle.presetRegexScripts || [],
    });
  }, [settings, updateSettings]);

  const handleDeletePresetBundle = useCallback(async (presetId: string) => {
    const bundleId = (settings.savedPresets || []).find(
      (bundle) => bundle.preset.id === presetId,
    )?.id;
    if (!bundleId) return;
    if (!await showCustomConfirm("确定要删除这个本地保存的预设吗？")) return;

    const nextSaved = (settings.savedPresets || []).filter((bundle) => bundle.id !== bundleId);
    const nextPreset = nextSaved.length > 0 ? nextSaved[0].preset : DEFAULT_SETTINGS.preset;
    const fallbackBundle = nextSaved.length > 0
      ? nextSaved[0]
      : {
          promptConfig: toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
          composition: DEFAULT_SETTINGS.promptConfig.composition,
          usePromptComposition: DEFAULT_SETTINGS.promptConfig.usePromptComposition,
        };
    const nextPromptConfig = applyPresetCompositionToPromptConfig(
      applyPresetPromptConfig(settings.promptConfig, fallbackBundle.promptConfig),
      fallbackBundle,
    );
    updateSettings({
      ...settings,
      preset: nextPreset,
      promptConfig: nextPromptConfig,
      savedPresets: nextSaved,
    });
    await presetService.saveStoredSavedPresets(nextSaved);
  }, [settings, showCustomConfirm, updateSettings, presetService]);

  const handleDeletePresetBundles = useCallback(async (bundleIds: string[]) => {
    if (bundleIds.length === 0) return;
    if (!await showCustomConfirm(`确定要批量删除这 ${bundleIds.length} 个本地预设包吗？`)) return;

    const nextSaved = (settings.savedPresets || []).filter(
      (bundle) => !bundleIds.includes(bundle.id),
    );
    let nextPreset = settings.preset;
    let nextPromptConfig = settings.promptConfig;
    let nextRegex = settings.presetRegexScripts;
    const isCurrentDeleted = bundleIds.includes(settings.preset.id)
      || (settings.savedPresets || []).some((bundle) =>
        bundle.preset.id === settings.preset.id && bundleIds.includes(bundle.id));
    if (isCurrentDeleted) {
      if (nextSaved.length > 0) {
        nextPreset = nextSaved[0].preset;
        nextPromptConfig = applyPresetCompositionToPromptConfig(
          applyPresetPromptConfig(settings.promptConfig, nextSaved[0].promptConfig),
          nextSaved[0],
        );
        nextRegex = nextSaved[0].presetRegexScripts || [];
      } else {
        nextPreset = DEFAULT_SETTINGS.preset;
        const defaultBundle = {
          promptConfig: toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
          composition: DEFAULT_SETTINGS.promptConfig.composition,
          usePromptComposition: DEFAULT_SETTINGS.promptConfig.usePromptComposition,
        };
        nextPromptConfig = applyPresetCompositionToPromptConfig(
          applyPresetPromptConfig(settings.promptConfig, defaultBundle.promptConfig),
          defaultBundle,
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
