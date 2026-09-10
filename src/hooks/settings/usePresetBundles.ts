import React, { useCallback } from "react";
import type { PromptConfig, SavedPresetBundle, UserSettings } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import type { IKernel, IPresetService, IRuntimeProfileService } from "@/src/application/serviceContracts";
import { KernelServices } from "@/src/application/serviceContracts";
import type { RuntimeProfileRecord } from "@/src/application/runtimeProfiles/contracts";
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
  buildPresetBundleSnapshot,
  collectPresetBundleReferences,
  isPresetBundleInSync,
  resolvePresetBundleActivation,
  type PresetBundleActivation,
} from "../../application/useCases/presetBundleLifecycle";
import {
  createPromptPresetPlan,
  normalizeSavedPresetPromptPlan,
  resolvePromptPresetPlan,
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
  handleSaveCurrentPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => Promise<void>;
  handleDeletePresetBundle: (bundleId: string) => Promise<void>;
  handleDeletePresetBundles: (bundleIds: string[]) => Promise<void>;
  isActivePresetDirty: boolean;
}

const isBuiltinBundle = (bundle: SavedPresetBundle | undefined): boolean =>
  Boolean(bundle && (bundle.isBuiltin || bundle.preset.id === DEFAULT_SETTINGS.preset.id));

/** 读取 Runtime Profile 列表；服务缺失时降级为空列表，不阻断预设删除流程。 */
const listRuntimeProfilesSafely = (kernel: IKernel): RuntimeProfileRecord[] => {
  try {
    const catalog = kernel.getService<IRuntimeProfileService>(KernelServices.RuntimeProfiles).listProfiles();
    return Array.isArray(catalog?.profiles) ? [...catalog.profiles] : [];
  } catch (error: unknown) {
    console.warn("[usePresetBundles] 无法读取 Runtime Profile 列表，跳过预设引用检查", error);
    return [];
  }
};

/** 删除预设后的回退补丁：必须与切换共用同一套激活规则，避免漏掉预设正则等字段。 */
const resolveFallbackActivation = (
  remaining: SavedPresetBundle[],
  currentPromptConfig: PromptConfig,
): PresetBundleActivation => {
  const fallback = remaining[0];
  if (fallback) {
    return resolvePresetBundleActivation(currentPromptConfig, fallback, DEFAULT_SETTINGS.preset);
  }
  return resolvePresetBundleActivation(
    currentPromptConfig,
    {
      preset: DEFAULT_SETTINGS.preset,
      promptConfig: toPresetPromptConfig(DEFAULT_PROMPT_CONFIG),
      promptPlan: createPromptPresetPlan(DEFAULT_SETTINGS.promptConfig),
    },
    DEFAULT_SETTINGS.preset,
  );
};

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

  const activeBundle = (settings.savedPresets || []).find(
    (bundle) => bundle.preset.id === settings.preset.id,
  );
  // 内置预设会在启动时被强制重建，覆盖它没有意义；脏检查以"预设明确拥有的字段"为准。
  const isActivePresetDirty = Boolean(
    activeBundle && !isPresetBundleInSync(activeBundle, settings, DEFAULT_SETTINGS.preset),
  );

  /** 删除前提示：被 Agent Profile 引用时必须说明不可逆后果。 */
  const buildDeleteConfirmMessage = useCallback((bundleIds: string[], baseMessage: string): string => {
    const profiles = listRuntimeProfilesSafely(kernel);
    const referencedNames = [...new Set(bundleIds.flatMap((bundleId) =>
      collectPresetBundleReferences(bundleId, profiles).profileNames,
    ))];
    if (referencedNames.length === 0) return baseMessage;
    const preview = referencedNames.slice(0, 3).join("、");
    const suffix = referencedNames.length > 3 ? " 等" : "";
    return `${baseMessage}\n\n该预设正被 ${referencedNames.length} 个 Agent Profile 引用（${preview}${suffix}）。`
      + "删除后这些 Profile 无法启动，已冻结该预设的会话也将无法继续发送；历史消息保留，但只能新建会话恢复对话。"
      + "\n\n确定仍要删除吗？";
  }, [kernel]);

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
          neutralPromptConfig: DEFAULT_PROMPT_CONFIG,
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
        // DB 是 savedPresets 的单一事实来源，避免陈旧闭包回退已保存预设。
        const currentSavedFromDB = (await presetService.getStoredSavedPresets()) || [];
        const nextSaved = [...currentSavedFromDB, importedBundle];
        updateSettings((prev) => {
          return {
            ...prev,
            ...resolvePresetBundleActivation(prev.promptConfig, importedBundle, DEFAULT_SETTINGS.preset),
            savedPresets: nextSaved,
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
  }, [settings.promptConfig, updateSettings, showCustomAlert, showCustomConfirm, presetService, compatibilityCodec]);

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

  const handleSaveNewPresetBundle = useCallback(async () => {
    const name = await showCustomPrompt(
      "请输入新预设的名称",
      settings.preset.name + " 的副本",
    );
    if (!name) return;

    const newBundle = buildPresetBundleSnapshot(
      {
        preset: {
          ...settings.preset,
          id: "preset_" + Math.random().toString(36).substring(2, 9),
          name,
        },
        promptConfig: settings.promptConfig,
        presetRegexScripts: settings.presetRegexScripts,
      },
      { id: "bundle_" + Math.random().toString(36).substring(2, 9), planSource: "native" },
    );
    try {
      // Preset Store 是保存列表的单一来源。设置页可能仍持有启动阶段的旧快照，
      // 直接从 settings.savedPresets 追加会覆盖刚导入或刚保存的预设。
      const stored = await presetService.getStoredSavedPresets();
      const currentSaved = stored ?? settings.savedPresets ?? [];
      const nextSaved = [...currentSaved, newBundle];
      await presetService.saveStoredSavedPresets(nextSaved);
      updateSettings((prev) => ({
        ...prev,
        ...resolvePresetBundleActivation(prev.promptConfig, newBundle, DEFAULT_SETTINGS.preset),
        savedPresets: nextSaved,
      }));
      await showCustomAlert(`成功保存新预设：${name}`);
    } catch (error: unknown) {
      console.error("Failed to save preset bundle:", error);
      await showCustomAlert("新预设保存失败，请稍后重试。", "保存失败");
    }
  }, [settings, showCustomPrompt, updateSettings, showCustomAlert, presetService]);

  /** 把当前设置（采样、提示词、编排、正则）整体写回当前预设，避免切换时丢失编辑。 */
  const handleSaveCurrentPresetBundle = useCallback(async () => {
    if (!activeBundle) {
      await showCustomAlert("当前没有可保存的预设包，请先使用「另存为新预设副本」创建。", "无法保存");
      return;
    }
    // 内置预设会在启动时按出厂内容重建，无法直接覆盖：保存时另存为新的自定义预设并切换过去，
    // 让"修改后内容不变"不再发生，同时保住出厂预设的升级路径。
    const isBuiltinActive = isBuiltinBundle(activeBundle);
    const snapshot = isBuiltinActive
      ? buildPresetBundleSnapshot(
          {
            ...settings,
            preset: {
              ...settings.preset,
              id: "preset_" + Math.random().toString(36).substring(2, 9),
              name: `${settings.preset.name}（我的修改）`,
            },
          },
          {
            id: "bundle_" + Math.random().toString(36).substring(2, 9),
            planSource: "native",
          },
        )
      : buildPresetBundleSnapshot(settings, {
          id: activeBundle.id,
          planSource: resolvePromptPresetPlan(activeBundle).source,
        });
    try {
      const stored = await presetService.getStoredSavedPresets();
      const currentSaved = stored ?? settings.savedPresets ?? [];
      // 存储里缺失当前预设（刚导入/刚另存尚未同步）时追加，避免静默"保存成功"但什么都没写。
      const hasTarget = !isBuiltinActive && currentSaved.some((bundle) => bundle.id === activeBundle.id);
      const nextSaved = hasTarget
        ? currentSaved.map((bundle) => (bundle.id === activeBundle.id ? snapshot : bundle))
        : [...currentSaved, snapshot];
      await presetService.saveStoredSavedPresets(nextSaved);
      updateSettings((prev) => ({
        ...prev,
        ...resolvePresetBundleActivation(prev.promptConfig, snapshot, DEFAULT_SETTINGS.preset),
        savedPresets: nextSaved,
      }));
      await showCustomAlert(isBuiltinActive
        ? `内置预设不可直接覆盖，已将当前修改另存为「${snapshot.preset.name}」并切换过去。`
        : `已将当前修改保存到预设「${snapshot.preset.name}」。`);
    } catch (error: unknown) {
      console.error("Failed to save current preset bundle:", error);
      await showCustomAlert("保存到当前预设失败，请稍后重试。", "保存失败");
    }
  }, [activeBundle, settings, updateSettings, showCustomAlert, presetService]);

  const handleLoadPresetBundle = useCallback(async (bundleId: string) => {
    const bundle = (settings.savedPresets || []).find((candidate) => candidate.id === bundleId);
    if (!bundle) return;
    if (isActivePresetDirty) {
      const confirmed = await showCustomConfirm(
        "当前预设存在未保存的修改，切换后会丢失这些修改。\n\n如需保留，请先点击「保存修改到当前预设」或「另存为新预设副本」。\n\n仍要切换吗？",
      );
      if (!confirmed) return;
    }
    updateSettings({
      ...settings,
      ...resolvePresetBundleActivation(settings.promptConfig, bundle, DEFAULT_SETTINGS.preset),
    });
  }, [settings, updateSettings, isActivePresetDirty, showCustomConfirm]);

  const handleDeletePresetBundle = useCallback(async (bundleId: string) => {
    const bundle = (settings.savedPresets || []).find((candidate) => candidate.id === bundleId);
    if (!bundle) return;
    if (isBuiltinBundle(bundle)) {
      await showCustomAlert("内置预设不可删除。", "无法删除");
      return;
    }
    const confirmMessage = buildDeleteConfirmMessage([bundleId], "确定要删除这个本地保存的预设吗？");
    if (!await showCustomConfirm(confirmMessage)) return;

    const nextSaved = (settings.savedPresets || []).filter((candidate) => candidate.id !== bundleId);
    const isActiveDeleted = bundle.preset.id === settings.preset.id;
    // 先落库再改内存状态：写库失败时保持界面与存储一致。
    try {
      await presetService.saveStoredSavedPresets(nextSaved);
    } catch (error: unknown) {
      console.error("Failed to delete preset bundle:", error);
      await showCustomAlert("删除预设失败，请稍后重试。", "删除失败");
      return;
    }
    updateSettings({
      ...settings,
      savedPresets: nextSaved,
      ...(isActiveDeleted
        ? resolveFallbackActivation(nextSaved, settings.promptConfig)
        : {}),
    });
  }, [settings, showCustomConfirm, showCustomAlert, updateSettings, presetService, buildDeleteConfirmMessage]);

  const handleDeletePresetBundles = useCallback(async (bundleIds: string[]) => {
    if (bundleIds.length === 0) return;
    const targets = (settings.savedPresets || []).filter((bundle) => bundleIds.includes(bundle.id));
    const deletableIds = targets
      .filter((bundle) => !isBuiltinBundle(bundle))
      .map((bundle) => bundle.id);
    if (deletableIds.length === 0) {
      await showCustomAlert("所选预设均为内置预设，不可删除。", "无法删除");
      return;
    }
    if (!await showCustomConfirm(buildDeleteConfirmMessage(
      deletableIds,
      `确定要批量删除这 ${deletableIds.length} 个本地预设包吗？`,
    ))) return;

    const nextSaved = (settings.savedPresets || []).filter(
      (bundle) => !deletableIds.includes(bundle.id),
    );
    const isCurrentDeleted = targets.some(
      (bundle) => deletableIds.includes(bundle.id) && bundle.preset.id === settings.preset.id,
    );
    try {
      await presetService.saveStoredSavedPresets(nextSaved);
    } catch (error: unknown) {
      console.error("Failed to batch delete preset bundles:", error);
      await showCustomAlert("批量删除预设失败，请稍后重试。", "删除失败");
      return;
    }
    updateSettings({
      ...settings,
      savedPresets: nextSaved,
      ...(isCurrentDeleted
        ? resolveFallbackActivation(nextSaved, settings.promptConfig)
        : {}),
    });
    await showCustomAlert("🎉 批量删除成功！");
  }, [settings, showCustomConfirm, updateSettings, showCustomAlert, presetService, buildDeleteConfirmMessage]);

  return {
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleSaveCurrentPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
    isActivePresetDirty,
  };
};
