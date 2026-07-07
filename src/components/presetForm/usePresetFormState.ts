import { useState } from "react";
import type { UserSettings, CharacterCard } from "../../types";

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
  const activeBundleId = (settings.savedPresets || []).find(
    (b) => b.preset.id === settings.preset.id
  )?.id || "";

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
    setIsSamplersFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_samplers", String(next));
      return next;
    });
  };
  const handleTogglePromptsFold = () => {
    setIsPromptsFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_prompts", String(next));
      return next;
    });
  };
  const handleToggleRegexFold = () => {
    setIsRegexFolded((prev) => {
      const next = !prev;
      localStorage.setItem("mobile_tavern_preset_fold_regex", String(next));
      return next;
    });
  };

  // 计算卡片折叠状态摘要信息
  const activeCustomPrompts = (settings.promptConfig?.customPrompts || []).filter((p: any) => p.enabled).length;
  const systemOn = settings.promptConfig?.useMainPrompt;
  const jailbreakOn = settings.promptConfig?.useJailbreak;
  const postHistoryOn = settings.promptConfig?.usePostHistory;
  const reasoningOn = settings.promptConfig?.enableReasoningGuidance ?? true;

  const coreStatusText = [
    systemOn ? "Sys" : null,
    jailbreakOn ? "Jb" : null,
    postHistoryOn ? "Post" : null,
    reasoningOn ? "Reason" : null
  ].filter(Boolean).join("+") || "无";

  const activeGlobalRegex = (settings.globalRegexScripts || []).filter((r: any) => !r.disabled).length;
  const activePresetRegex = (settings.presetRegexScripts || []).filter((r: any) => !r.disabled).length;
  const activeCharRegex = (activeCharacter?.extensions?.regex_scripts || []).filter((r: any) => !r.disabled).length;

  // 正则脚本编辑器局部状态
  const [editingRegex, setEditingRegex] = useState<any>(null);
  const [isRegexModalOpen, setIsRegexModalOpen] = useState(false);

  const toggleRegexDisabled = async (id: string, disabled: boolean, scope: "global" | "preset" | "character") => {
    if (scope === "character") {
      if (!activeCharacter) return;
      const rawScripts = activeCharacter.extensions?.regex_scripts || [];
      const scripts = Array.isArray(rawScripts)
        ? rawScripts
        : (rawScripts && typeof rawScripts === "object" ? Object.values(rawScripts) : []);
      const updatedScripts = scripts.map((r: any) => (r.id === id || r.scriptName === id ? { ...r, disabled } : r));
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
      const list = (prev as any)[field] || [];
      return {
        ...prev,
        [field]: list.map((r: any) => (r.id === id ? { ...r, disabled } : r)),
      };
    });
  };

  const deleteRegex = async (id: string, name: string, scope: "global" | "preset" | "character") => {
    const scopeName = scope === "global" ? "全局" : (scope === "preset" ? "预设专属" : "角色专属");
    const ok = await showCustomConfirm(`确定要删除${scopeName}正则脚本【${name}】吗？`);
    if (!ok) return;

    if (scope === "character") {
      if (!activeCharacter) return;
      const rawScripts = activeCharacter.extensions?.regex_scripts || [];
      const scripts = Array.isArray(rawScripts)
        ? rawScripts
        : (rawScripts && typeof rawScripts === "object" ? Object.values(rawScripts) : []);
      const updatedScripts = scripts.filter((r: any) => r.id !== id && r.scriptName !== id);
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
      const list = (prev as any)[field] || [];
      return {
        ...prev,
        [field]: list.filter((r: any) => r.id !== id),
      };
    });
  };

  const saveRegex = async (reg: any) => {
    if (!reg.scriptName || !reg.scriptName.trim() || !reg.findRegex || !reg.findRegex.trim()) {
      showCustomAlert("脚本名称和正则表达式匹配串不能为空！");
      return;
    }
    const scope = reg.scope || "global";
    if (scope === "character") {
      if (!activeCharacter) return;
      const rawScripts = activeCharacter.extensions?.regex_scripts || [];
      const scripts = Array.isArray(rawScripts)
        ? rawScripts
        : (rawScripts && typeof rawScripts === "object" ? Object.values(rawScripts) : []);
      const exists = scripts.some((r: any) => r.id === reg.id || (r.scriptName && r.scriptName === reg.id));
      let nextList;
      if (exists) {
        nextList = scripts.map((r: any) => (r.id === reg.id || r.scriptName === reg.id ? reg : r));
      } else {
        nextList = [...scripts, reg];
      }
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
      const list = (prev as any)[field] || [];
      const exists = list.some((r: any) => r.id === reg.id);
      let nextList;
      if (exists) {
        nextList = list.map((r) => (r.id === reg.id ? reg : r));
      } else {
        nextList = [...list, reg];
      }
      return {
        ...prev,
        [field]: nextList,
      };
    });
    setIsRegexModalOpen(false);
    setEditingRegex(null);
  };

  // 批量删除处理逻辑
  const handleBatchDeletePrompts = async () => {
    if (selectedPromptIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedPromptIds.length} 个提示词模组吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: (prev.promptConfig.customPrompts || []).filter(
          (p: any) => !selectedPromptIds.includes(p.id)
        ),
      },
    }));
    setSelectedPromptIds([]);
    setIsBatchDeletingPrompts(false);
  };

  const handleBatchDeleteGlobalRegex = async () => {
    if (selectedGlobalRegexIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedGlobalRegexIds.length} 个全局正则脚本吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      globalRegexScripts: (prev.globalRegexScripts || []).filter(
        (r: any) => !selectedGlobalRegexIds.includes(r.id)
      ),
    }));
    setSelectedGlobalRegexIds([]);
    setIsBatchDeletingGlobalRegex(false);
  };

  const handleBatchDeletePresetRegex = async () => {
    if (selectedPresetRegexIds.length === 0) return;
    const ok = await showCustomConfirm(`确定要批量删除选中的 ${selectedPresetRegexIds.length} 个预设专属正则脚本吗？`);
    if (!ok) return;
    updateSettings((prev: any) => ({
      ...prev,
      presetRegexScripts: (prev.presetRegexScripts || []).filter(
        (r: any) => !selectedPresetRegexIds.includes(r.id)
      ),
    }));
    setSelectedPresetRegexIds([]);
    setIsBatchDeletingPresetRegex(false);
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
    handleBatchDeletePrompts,
    handleBatchDeleteGlobalRegex,
    handleBatchDeletePresetRegex,
  };
}
