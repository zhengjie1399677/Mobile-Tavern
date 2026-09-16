import type * as React from "react";
import { useCallback } from "react";
import { UserSettings } from "../../types";
import { applyLegacyPromptRemoval, applyLegacyPromptSwitch } from "../../application/useCases/promptSwitchSync";

interface UseCustomPromptsDeps {
  settings: UserSettings;
  updateSettings: (
    updater: UserSettings | ((prev: UserSettings) => UserSettings)
  ) => void;
  setExpandedPromptIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  showCustomConfirm: (message: string) => Promise<boolean>;
}

interface UseCustomPromptsReturn {
  handleToggleCustomPrompt: (id: string, enabled: boolean) => void;
  handleUpdateCustomPrompt: (
    id: string,
    name: string,
    role: any,
    content: string
  ) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
}

/**
 * 自定义提示词管理子 Hook。
 *
 * 负责提示词模组的启用/禁用切换、内容更新、新增与删除。
 */
export const useCustomPrompts = ({
  settings,
  updateSettings,
  setExpandedPromptIds,
  showCustomConfirm,
}: UseCustomPromptsDeps): UseCustomPromptsReturn => {
  /**
   * 列表侧开关。
   *
   * 必须走函数式通道（值形式会被 getNestedDelta + deepMerge 撤销数组/字段级删除语义），
   * 并同步同源编排区块：列表与编排放任一处关闭，两侧与运行时都必须一致。
   */
  const handleToggleCustomPrompt = useCallback((id: string, enabled: boolean) => {
    updateSettings((prev) => ({
      ...prev,
      promptConfig: applyLegacyPromptSwitch(prev.promptConfig, id, enabled),
    }));
  }, [updateSettings]);

  const handleUpdateCustomPrompt = useCallback((
    id: string,
    name: string,
    role: any,
    content: string,
  ) => {
    updateSettings((prev) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: (prev.promptConfig.customPrompts || []).map((item) =>
          item.id === id ? { ...item, name, role: "system" as const, content } : item),
      },
    }));
  }, [updateSettings]);

  const handleAddNewCustomPrompt = useCallback(() => {
    const newId = "comp_" + Math.random().toString(36).substring(2, 9);
    const newItem = {
      id: newId,
      name: `新预设指令或文风约束_${(settings.promptConfig.customPrompts || []).length + 1}`,
      role: "system" as const,
      content: "",
      enabled: true,
    };

    setExpandedPromptIds((prev) => new Set(prev).add(newId));

    updateSettings((prev) => ({
      ...prev,
      promptConfig: {
        ...prev.promptConfig,
        customPrompts: [...(prev.promptConfig.customPrompts || []), newItem],
      },
    }));
  }, [settings.promptConfig.customPrompts, setExpandedPromptIds, updateSettings]);

  /**
   * 列表侧删除。
   *
   * 必须连带删除同源的编排区块：只删列表会让条目在编排模式下既不生效、又和已被删掉的区块对不上。
   * 编排侧若开着编辑器仍可从它的撤销栈整份还原，列表侧本身不提供撤销。
   */
  const handleDeleteCustomPrompt = useCallback(async (id: string) => {
    const ok = await showCustomConfirm("确定删除这个自定义预设指令组件吗？编排中的同源区块会一并删除。");
    if (!ok) return;
    updateSettings((prev) => ({
      ...prev,
      promptConfig: applyLegacyPromptRemoval(prev.promptConfig, [id]),
    }));
  }, [showCustomConfirm, updateSettings]);

  return {
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
  };
};
