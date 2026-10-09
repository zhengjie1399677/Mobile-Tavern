import { useEffect, useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { UserSettings, CharacterCard, RegexScript, PromptConfig, CustomPromptBlock } from "../../types";
import { resolveActivePresetBundle } from "../../application/useCases/presetBundleLifecycle";
import { removePromptBlocksByIds } from "../../domain/prompts/promptBlockIdentity";
import {
  normalizeRegexScripts,
  regexScriptKey,
  removeRegexScriptByKey,
  setRegexScriptDisabledByKey,
  toPersistedRegexScript,
  upsertRegexScriptByKey,
} from "../../domain/regex/regexScriptIdentity";

export type RegexEditorScope = "global" | "preset" | "character";
export type EditableRegexScript = RegexScript & { scope?: RegexEditorScope };

export interface UsePresetFormStateParams {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  activeCharacter: CharacterCard | null;
  saveCharacter: (character: CharacterCard) => Promise<void>;
}

/**
 * 预设表单状态聚合 Hook：
 * 集中管理折叠开关、正则 toggle/save/delete、批量删除等局部状态与处理器。
 * 该 Hook 仅负责状态与副作用逻辑，不持有任何 JSX 视图。
 */
export function usePresetFormState({
  settings,
  updateSettings,
  showCustomConfirm,
  showCustomAlert,
  activeCharacter,
  saveCharacter,
}: UsePresetFormStateParams) {
  const { t } = useTranslation();
  const activeBundleId = resolveActivePresetBundle(settings.savedPresets, settings.preset)?.id || "";

  // 子条目多选状态
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedGlobalRegexIds, setSelectedGlobalRegexIds] = useState<string[]>([]);
  const [selectedPresetRegexIds, setSelectedPresetRegexIds] = useState<string[]>([]);

  // 批量删除编辑模式状态
  const [isBatchDeletingPrompts, setIsBatchDeletingPrompts] = useState(false);
  const [isBatchDeletingGlobalRegex, setIsBatchDeletingGlobalRegex] = useState(false);
  const [isBatchDeletingPresetRegex, setIsBatchDeletingPresetRegex] = useState(false);

  // 表单折叠状态（默认折叠，通过 localStorage 持久化记住操作）
  const [isSamplersFolded, setIsSamplersFolded] = useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_samplers");
    return val !== null ? val === "true" : true;
  });
  const [isPromptsFolded, setIsPromptsFolded] = useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_prompts");
    return val !== null ? val === "true" : true;
  });
  const [isRegexFolded, setIsRegexFolded] = useState(() => {
    const val = localStorage.getItem("mobile_tavern_preset_fold_regex");
    return val !== null ? val === "true" : true;
  });

  const handleToggleSamplersFold = () => {
    const next = !isSamplersFolded;
    localStorage.setItem("mobile_tavern_preset_fold_samplers", String(next));
    setIsSamplersFolded(next);
  };
  const handleTogglePromptsFold = () => {
    const next = !isPromptsFolded;
    localStorage.setItem("mobile_tavern_preset_fold_prompts", String(next));
    setIsPromptsFolded(next);
  };
  const handleToggleRegexFold = () => {
    const next = !isRegexFolded;
    localStorage.setItem("mobile_tavern_preset_fold_regex", String(next));
    setIsRegexFolded(next);
  };

  // 计算卡片折叠状态摘要信息
  const activeCustomPrompts = (settings.promptConfig?.customPrompts || []).filter((p: CustomPromptBlock) => p.enabled).length;
  const systemOn = settings.promptConfig?.useMainPrompt;
  const jailbreakOn = settings.promptConfig?.useJailbreak;
  const postHistoryOn = settings.promptConfig?.usePostHistory;
  const reasoningOn = settings.promptConfig?.enableReasoningGuidance ?? true;

  const coreStatusText = [
    systemOn ? "Sys" : null,
    jailbreakOn ? "Jb" : null,
    postHistoryOn ? "Post" : null,
    reasoningOn ? "Reason" : null
  ].filter(Boolean).join("+") || t("preset_form.none");

  const activeGlobalRegex = (settings.globalRegexScripts || []).filter((r: RegexScript) => !r.disabled).length;
  const activePresetRegex = (settings.presetRegexScripts || []).filter((r: RegexScript) => !r.disabled).length;
  const activeCharRegex = normalizeRegexScripts(activeCharacter?.extensions?.regex_scripts)
    .filter((r) => !r.disabled).length;

  // 正则脚本编辑器局部状态
  const [editingRegex, setEditingRegex] = useState<EditableRegexScript | null>(null);
  const [isRegexModalOpen, setIsRegexModalOpen] = useState(false);

  // 切换预设时清空批量选择：选择里存的是跨预设可能重名的 key，
  // 留着会让下一次"删除选中"误伤新预设的同名条目。
  useEffect(() => {
    setSelectedPromptIds([]);
    setSelectedGlobalRegexIds([]);
    setSelectedPresetRegexIds([]);
    setIsBatchDeletingPrompts(false);
    setIsBatchDeletingGlobalRegex(false);
    setIsBatchDeletingPresetRegex(false);
  }, [activeBundleId]);

  const toggleRegexDisabled = async (id: string, disabled: boolean, scope: "global" | "preset" | "character") => {
    if (scope === "character") {
      if (!activeCharacter) return;
      const scripts = normalizeRegexScripts(activeCharacter.extensions?.regex_scripts);
      // 身份按 regexScriptKey 判定：缺 id 的历史脚本用 scriptName，否则命中不了、开关静默失效。
      const updatedScripts = setRegexScriptDisabledByKey(scripts, id, disabled);
      if (updatedScripts === scripts) return;
      const updatedChar = {
        ...activeCharacter,
        extensions: {
          ...activeCharacter.extensions,
          regex_scripts: updatedScripts,
        },
      };
      await saveCharacter(updatedChar);
      return;
    }
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      const list = prev[field] || [];
      const nextList = setRegexScriptDisabledByKey(list, id, disabled);
      if (nextList === list) return prev;
      return {
        ...prev,
        [field]: nextList,
      };
    });
  };

  const deleteRegex = async (id: string, name: string, scope: "global" | "preset" | "character") => {
    const scopeName = scope === "global" ? t("preset_form.scope_global") : (scope === "preset" ? t("preset_form.scope_preset") : t("preset_form.scope_char"));
    const ok = await showCustomConfirm(t("preset_form.confirm_delete_regex", { scope: scopeName, name }));
    if (!ok) return;

    if (scope === "character") {
      if (!activeCharacter) return;
      const scripts = normalizeRegexScripts(activeCharacter.extensions?.regex_scripts);
      const updatedScripts = removeRegexScriptByKey(scripts, id);
      if (updatedScripts === scripts) return;
      const updatedChar = {
        ...activeCharacter,
        extensions: {
          ...activeCharacter.extensions,
          regex_scripts: updatedScripts,
        },
      };
      await saveCharacter(updatedChar);
      return;
    }
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      const list = prev[field] || [];
      const nextList = removeRegexScriptByKey(list, id);
      if (nextList === list) return prev;
      return {
        ...prev,
        [field]: nextList,
      };
    });
  };

  const saveRegex = async (reg: EditableRegexScript) => {
    if (!reg.scriptName || !reg.scriptName.trim() || !reg.findRegex || !reg.findRegex.trim()) {
      showCustomAlert(t("preset_form.regex_empty_error"));
      return;
    }
    const scope = reg.scope || "global";
    if (scope === "character") {
      if (!activeCharacter) return;
      const scripts = normalizeRegexScripts(activeCharacter.extensions?.regex_scripts);
      const nextList = upsertRegexScriptByKey(scripts, toPersistedRegexScript(reg));
      const updatedChar = {
        ...activeCharacter,
        extensions: {
          ...activeCharacter.extensions,
          regex_scripts: nextList,
        },
      };
      await saveCharacter(updatedChar);
      setIsRegexModalOpen(false);
      setEditingRegex(null);
      return;
    }
    updateSettings((prev) => {
      const field = scope === "global" ? "globalRegexScripts" : "presetRegexScripts";
      return {
        ...prev,
        [field]: upsertRegexScriptByKey(prev[field] || [], toPersistedRegexScript(reg)),
      };
    });
    setIsRegexModalOpen(false);
    setEditingRegex(null);
  };

  // 批量删除处理逻辑
  const handleBatchDeletePrompts = async () => {
    if (selectedPromptIds.length === 0) return;
    const ok = await showCustomConfirm(t("preset_form.confirm_batch_delete_prompts", { count: String(selectedPromptIds.length) }));
    if (!ok) return;
    // 连带删除同源的编排区块：列表与编排是同一批条目的两种视图，删除必须两侧一致。
    updateSettings((prev) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: removePromptBlocksByIds(prev.promptConfig.customPrompts ?? [], selectedPromptIds),
      },
    }));
    setSelectedPromptIds([]);
    setIsBatchDeletingPrompts(false);
  };

  const handleBatchDeleteGlobalRegex = async () => {
    if (selectedGlobalRegexIds.length === 0) return;
    const ok = await showCustomConfirm(t("preset_form.confirm_batch_delete_global_regex", { count: String(selectedGlobalRegexIds.length) }));
    if (!ok) return;
    updateSettings((prev) => ({
      ...prev,
      globalRegexScripts: (prev.globalRegexScripts || []).filter(
        (r: RegexScript) => !selectedGlobalRegexIds.includes(regexScriptKey(r))
      ),
    }));
    setSelectedGlobalRegexIds([]);
    setIsBatchDeletingGlobalRegex(false);
  };

  const handleBatchDeletePresetRegex = async () => {
    if (selectedPresetRegexIds.length === 0) return;
    const ok = await showCustomConfirm(t("preset_form.confirm_batch_delete_preset_regex", { count: String(selectedPresetRegexIds.length) }));
    if (!ok) return;
    updateSettings((prev) => ({
      ...prev,
      presetRegexScripts: (prev.presetRegexScripts || []).filter(
        (r: RegexScript) => !selectedPresetRegexIds.includes(regexScriptKey(r))
      ),
    }));
    setSelectedPresetRegexIds([]);
    setIsBatchDeletingPresetRegex(false);
  };

  /**
   * 删除内置「系统提示词 / 规则提示词」。
   *
   * 该动作会清空整段提示词且没有撤销，必须与自定义条目同口径二次确认
   * （列表里删除按钮紧贴展开箭头，误触会静默丢掉整段内容）。
   */
  const deleteBuiltinPrompt = async (kind: "main" | "jailbreak") => {
    const name = t(kind === "main" ? "prompts.system_prompt" : "prompts.jailbreak");
    const ok = await showCustomConfirm(t("preset_form.confirm_delete_builtin_prompt", { name }));
    if (!ok) return;
    updateSettings((prev) => {
      const promptConfig: PromptConfig = kind === "main"
        ? { ...prev.promptConfig, useMainPrompt: false, mainPrompt: "" }
        : { ...prev.promptConfig, useJailbreak: false, jailbreakPrompt: "" };
      if (kind === "main") delete promptConfig.mainPromptName;
      else delete promptConfig.jailbreakPromptName;
      return { ...prev, promptConfig };
    });
  };

  return {
    activeBundleId,
    selectedPromptIds,
    setSelectedPromptIds,
    selectedGlobalRegexIds,
    setSelectedGlobalRegexIds,
    selectedPresetRegexIds,
    setSelectedPresetRegexIds,
    isBatchDeletingPrompts,
    setIsBatchDeletingPrompts,
    isBatchDeletingGlobalRegex,
    setIsBatchDeletingGlobalRegex,
    isBatchDeletingPresetRegex,
    setIsBatchDeletingPresetRegex,
    isSamplersFolded,
    handleToggleSamplersFold,
    isPromptsFolded,
    handleTogglePromptsFold,
    isRegexFolded,
    handleToggleRegexFold,
    coreStatusText,
    activeCustomPrompts,
    activeGlobalRegex,
    activePresetRegex,
    activeCharRegex,
    editingRegex,
    setEditingRegex,
    isRegexModalOpen,
    setIsRegexModalOpen,
    toggleRegexDisabled,
    deleteRegex,
    saveRegex,
    deleteBuiltinPrompt,
    handleBatchDeletePrompts,
    handleBatchDeleteGlobalRegex,
    handleBatchDeletePresetRegex,
  };
}
