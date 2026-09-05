import React, { useCallback, useEffect, useRef } from "react";
import type { SavedPresetBundle, UserSettings } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import type { IPresetService } from "@/src/application/serviceContracts";
import {
  getCompatibilityCodec,
  SILLY_TAVERN_PROMPT_PRESET_FORMAT,
} from "../../application/useCases/compatibilityGenerationState";
import {
  formatPresetOperationReport,
  formatSillyTavernCompatibilityAnalysis,
  preparePresetBundleImport,
} from "../../application/useCases/preparePresetBundleImport";
import { preparePresetBundleExport } from "../../application/useCases/preparePresetBundleExport";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "./defaults";
import {
  applyPresetCompositionToPromptConfig,
  applyPresetPromptConfig,
  createPromptPresetPlan,
  normalizeSavedPresetPromptPlan,
  toPresetPromptConfig,
} from "./presetPromptConfig";

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
  handleLoadPresetBundle: (bundleId: string) => Promise<void>;
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
  const compatibilityCodec = getCompatibilityCodec(
    kernel,
    SILLY_TAVERN_PROMPT_PRESET_FORMAT,
  );
  const latestSettingsRef = useRef(settings);
  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  const commitSettingsSnapshot = useCallback((next: Partial<Pick<UserSettings,
    "preset" | "promptConfig" | "presetRegexScripts" | "savedPresets"
  >>) => {
    latestSettingsRef.current = { ...latestSettingsRef.current, ...next };
    updateSettings((prev) => ({ ...prev, ...next }));
  }, [updateSettings]);

  const pendingOperationRef = useRef<Promise<void>>(Promise.resolve());
  const enqueuePresetOperation = useCallback((operation: () => Promise<void>) => {
    const pending = pendingOperationRef.current.then(operation);
    pendingOperationRef.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const persistSavedPresets = useCallback(async (bundles: SavedPresetBundle[]): Promise<boolean> => {
    try {
      await presetService.saveStoredSavedPresets(bundles);
      return true;
    } catch (error: unknown) {
      console.error("Failed to save preset bundles:", error);
      await showCustomAlert("预设保存失败，已保留当前界面状态，请稍后重试。", "保存失败");
      return false;
    }
  }, [presetService, showCustomAlert]);

  const handleImportPresetJSON = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.target;
    const reader = new FileReader();
    reader.onload = () => {
      const fileContent = reader.result;
      void enqueuePresetOperation(async () => {
      try {
        if (typeof fileContent !== "string") throw new Error("PRESET_FILE_NOT_TEXT");
        const parsed: unknown = JSON.parse(fileContent);
        const prepared = preparePresetBundleImport({
          input: parsed,
          fallbackName: file.name.replace(/\.json$/i, ""),
          currentPromptConfig: settings.promptConfig,
          compatibilityCodec,
        });
        const importedComposition = prepared.composition;
        const importReportText = formatPresetOperationReport(prepared.report);
        if (prepared.report.errors.length > 0) throw new Error("PRESET_IMPORT_REPORT_HAS_ERRORS");
        const enableImportedComposition = importedComposition
          ? await showCustomConfirm(
              `检测到 SillyTavern Prompt 编排。\n\n${prepared.compatibilityAnalysis
                ? formatSillyTavernCompatibilityAnalysis(prepared.compatibilityAnalysis)
                : ""}${importReportText ? `\n\n${importReportText}` : ""}\n\n是否立即启用自由编排以完整执行 Prompt 顺序、Marker 和注入位置？\n\n选择取消会以传统模式运行，但该预设仍独立保存其编排快照，之后可随时启用。`,
            )
          : false;
        // 规划属于预设：导入的编排快照与开关随预设包一起保存，切换预设时整体切换。
        const importedBundle = normalizeSavedPresetPromptPlan({
          ...prepared.bundle,
          promptPlan: importedComposition
            ? {
                version: 1,
                mode: enableImportedComposition ? "composition" : "legacy",
                source: "sillytavern",
                composition: importedComposition,
              }
            : prepared.bundle.promptPlan,
        });
        const importedRegexScripts = importedBundle.presetRegexScripts ?? [];

        // DB 是 savedPresets 的单一事实来源，避免陈旧闭包回退已保存预设。
        const currentSavedFromDB = (await presetService.getStoredSavedPresets()) || [];
        const nextSaved = [...currentSavedFromDB, importedBundle];
        {
          const promptConfig = applyPresetCompositionToPromptConfig(
            applyPresetPromptConfig(
              DEFAULT_PROMPT_CONFIG,
              importedBundle.promptConfig,
            ),
            importedBundle,
          );
          await presetService.saveStoredSavedPresets(nextSaved);
          commitSettingsSnapshot({
            preset: { ...DEFAULT_SETTINGS.preset, ...importedBundle.preset },
            presetRegexScripts: importedRegexScripts,
            savedPresets: nextSaved,
            promptConfig,
          });
        }
        await showCustomAlert(
          `预设已导入\n[${prepared.name}]${importReportText ? `\n\n${importReportText}` : ""}`,
        );
      } catch {
        await showCustomAlert("解析或保存预设 JSON 配置文件失败，请确保格式正确");
      } finally {
        input.value = "";
      }
      });
    };
    reader.readAsText(file);
  }, [settings.promptConfig, commitSettingsSnapshot, enqueuePresetOperation, showCustomAlert, showCustomConfirm, presetService, compatibilityCodec]);

  const handleExportPresetJSON = useCallback(() => {
    const prepared = preparePresetBundleExport({
      preset: settings.preset,
      promptConfig: settings.promptConfig,
      presetRegexScripts: settings.presetRegexScripts,
      compatibilityCodec,
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
  }, [settings, showCustomAlert, compatibilityCodec]);

  const handleSaveNewPresetBundle = useCallback(() => enqueuePresetOperation(async () => {
    const current = latestSettingsRef.current;
    const name = await showCustomPrompt(
      "请输入新预设的名称",
      current.preset.name + " 的副本",
    );
    if (!name) return;

    const newBundle: SavedPresetBundle = {
      id: "bundle_" + Math.random().toString(36).substring(2, 9),
      preset: {
        ...current.preset,
        id: "preset_" + Math.random().toString(36).substring(2, 9),
        name,
      },
      promptConfig: toPresetPromptConfig(current.promptConfig),
      promptPlan: createPromptPresetPlan(current.promptConfig, "native"),
      presetRegexScripts: current.presetRegexScripts ? [...current.presetRegexScripts] : [],
    };
    try {
      // Preset Store 是保存列表的单一来源。设置页可能仍持有启动阶段的旧快照，
      // 直接从 current.savedPresets 追加会覆盖刚导入或刚保存的预设。
      const stored = await presetService.getStoredSavedPresets();
      const currentSaved = stored ?? current.savedPresets ?? [];
      const nextSaved = [...currentSaved, newBundle];
      await presetService.saveStoredSavedPresets(nextSaved);
      commitSettingsSnapshot({
        preset: newBundle.preset,
        promptConfig: applyPresetPromptConfig(current.promptConfig, newBundle.promptConfig),
        presetRegexScripts: newBundle.presetRegexScripts,
        savedPresets: nextSaved,
      });
      await showCustomAlert(`成功保存新预设：${name}`);
    } catch (error: unknown) {
      console.error("Failed to save preset bundle:", error);
      await showCustomAlert("新预设保存失败，请稍后重试。", "保存失败");
    }
  }), [showCustomPrompt, commitSettingsSnapshot, enqueuePresetOperation, showCustomAlert, presetService]);

  const handleLoadPresetBundle = useCallback((bundleId: string) => enqueuePresetOperation(async () => {
    const current = latestSettingsRef.current;
    const currentSaved = current.savedPresets || [];
    if (!currentSaved.some((candidate) => candidate.id === bundleId)) return;

    // 如果当前活跃预设是用户自定义/导入预设（非内置），切换前先持久化最新状态。
    let updatedSaved = currentSaved;
    const currentBundleIdx = currentSaved.findIndex(
      (bundle) => bundle.preset.id === current.preset.id && !bundle.isBuiltin,
    );
    if (currentBundleIdx !== -1) {
      const currentBundle = currentSaved[currentBundleIdx];
      const updatedBundle: SavedPresetBundle = {
        ...currentBundle,
        preset: { ...current.preset },
        promptConfig: toPresetPromptConfig(current.promptConfig),
        promptPlan: createPromptPresetPlan(current.promptConfig, currentBundle.promptPlan?.source ?? "native"),
        presetRegexScripts: current.presetRegexScripts ? [...current.presetRegexScripts] : [],
      };
      updatedSaved = [...currentSaved];
      updatedSaved[currentBundleIdx] = updatedBundle;
      if (!await persistSavedPresets(updatedSaved)) return;
      // 保存期间仍允许编辑；发生新编辑时保留当前预设，避免用切换前快照覆盖。
      const latest = latestSettingsRef.current;
      if (latest.promptConfig !== current.promptConfig || latest.preset !== current.preset
        || latest.presetRegexScripts !== current.presetRegexScripts) {
        await showCustomAlert("保存期间预设内容已更新，已保留最新编辑，请重新选择目标预设。", "预设已更新");
        return;
      }
    }

    const bundle = updatedSaved.find((candidate) => candidate.id === bundleId);
    if (!bundle) return;
    const promptConfig = applyPresetCompositionToPromptConfig(
      applyPresetPromptConfig(DEFAULT_PROMPT_CONFIG, bundle.promptConfig),
      bundle,
    );
    commitSettingsSnapshot({
      preset: { ...DEFAULT_SETTINGS.preset, ...bundle.preset },
      promptConfig,
      presetRegexScripts: bundle.presetRegexScripts ? [...bundle.presetRegexScripts] : [],
      savedPresets: updatedSaved,
    });
  }), [commitSettingsSnapshot, persistSavedPresets, enqueuePresetOperation, showCustomAlert]);

  const handleDeletePresetBundle = useCallback((presetId: string) => enqueuePresetOperation(async () => {
    const ok = await showCustomConfirm("确定要删除这个本地保存的预设吗？");
    if (!ok) return;

    const current = latestSettingsRef.current;
    const currentSaved = current.savedPresets || [];
    const bundleId = currentSaved.find((bundle) => bundle.preset.id === presetId)?.id;
    if (!bundleId) return;

    const nextSaved = currentSaved.filter((bundle) => bundle.id !== bundleId);
    if (current.preset.id !== presetId) {
      if (await persistSavedPresets(nextSaved)) commitSettingsSnapshot({ savedPresets: nextSaved });
      return;
    }
    const fallbackBundle = nextSaved.length > 0
      ? nextSaved[0]
      : {
          preset: DEFAULT_SETTINGS.preset,
          promptConfig: toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
          promptPlan: createPromptPresetPlan(DEFAULT_SETTINGS.promptConfig),
          presetRegexScripts: [],
        };
    const nextPromptConfig = applyPresetCompositionToPromptConfig(
      applyPresetPromptConfig(DEFAULT_PROMPT_CONFIG, fallbackBundle.promptConfig),
      fallbackBundle,
    );
    if (!await persistSavedPresets(nextSaved)) return;
    commitSettingsSnapshot({
      preset: { ...DEFAULT_SETTINGS.preset, ...fallbackBundle.preset },
      promptConfig: nextPromptConfig,
      presetRegexScripts: fallbackBundle.presetRegexScripts
        ? [...fallbackBundle.presetRegexScripts]
        : [],
      savedPresets: nextSaved,
    });
  }), [showCustomConfirm, commitSettingsSnapshot, persistSavedPresets, enqueuePresetOperation]);

  const handleDeletePresetBundles = useCallback((bundleIds: string[]) => enqueuePresetOperation(async () => {
    if (bundleIds.length === 0) return;
    if (!await showCustomConfirm(`确定要批量删除这 ${bundleIds.length} 个本地预设包吗？`)) return;

    const current = latestSettingsRef.current;
    const currentSaved = current.savedPresets || [];
    const nextSaved = currentSaved.filter((bundle) => !bundleIds.includes(bundle.id));
    let nextPreset = current.preset;
    let nextPromptConfig = current.promptConfig;
    let nextRegex = current.presetRegexScripts;
    const isCurrentDeleted = currentSaved.some((bundle) =>
      bundle.preset.id === current.preset.id && bundleIds.includes(bundle.id));
    if (isCurrentDeleted) {
      if (nextSaved.length > 0) {
        nextPreset = nextSaved[0].preset;
        nextPromptConfig = applyPresetCompositionToPromptConfig(
          applyPresetPromptConfig(DEFAULT_PROMPT_CONFIG, nextSaved[0].promptConfig),
          nextSaved[0],
        );
        nextRegex = nextSaved[0].presetRegexScripts || [];
      } else {
        nextPreset = DEFAULT_SETTINGS.preset;
        const defaultBundle = {
          promptConfig: toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
          promptPlan: createPromptPresetPlan(DEFAULT_SETTINGS.promptConfig),
        };
        nextPromptConfig = applyPresetCompositionToPromptConfig(
          applyPresetPromptConfig(DEFAULT_PROMPT_CONFIG, defaultBundle.promptConfig),
          defaultBundle,
        );
        nextRegex = [];
      }
    }
    if (!await persistSavedPresets(nextSaved)) return;
    commitSettingsSnapshot({
      ...(isCurrentDeleted ? {
        preset: nextPreset,
        promptConfig: nextPromptConfig,
        presetRegexScripts: nextRegex ? [...nextRegex] : [],
      } : {}),
      savedPresets: nextSaved,
    });
    await showCustomAlert("🎉 批量删除成功！");
  }), [showCustomConfirm, commitSettingsSnapshot, persistSavedPresets, showCustomAlert, enqueuePresetOperation]);

  return {
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
  };
};
