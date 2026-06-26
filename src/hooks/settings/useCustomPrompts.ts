import type * as React from "react";
import { useCallback } from "react";
import { UserSettings } from "../../types";

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
  const handleToggleCustomPrompt = useCallback((id: string, enabled: boolean) => {
    const list = settings.promptConfig.customPrompts || [];
    const updated = list.map((item) =>
      item.id === id ? { ...item, enabled } : item,
    );
    updateSettings({
      ...settings,
      promptConfig: { ...settings.promptConfig, customPrompts: updated },
    });
  }, [settings, updateSettings]);

  const handleUpdateCustomPrompt = useCallback((
    id: string,
    name: string,
    role: any,
    content: string,
  ) => {
    const list = settings.promptConfig.customPrompts || [];
    const updated = list.map((item) =>
      item.id === id ? { ...item, name, role, content } : item,
    );
    updateSettings({
      ...settings,
      promptConfig: { ...settings.promptConfig, customPrompts: updated },
    });
  }, [settings, updateSettings]);

  const handleAddNewCustomPrompt = useCallback(() => {
    const list = settings.promptConfig.customPrompts || [];
    const newId = "comp_" + Math.random().toString(36).substring(2, 9);
    const newItem = {
      id: newId,
      name: `新预设指令或文风约束_${list.length + 1}`,
      role: "system" as const,
      content: "",
      enabled: true,
    };

    setExpandedPromptIds((prev) => new Set(prev).add(newId));

    updateSettings({
      ...settings,
      promptConfig: {
        ...settings.promptConfig,
        customPrompts: [...list, newItem],
      },
    });
  }, [settings, setExpandedPromptIds, updateSettings]);

  const handleDeleteCustomPrompt = useCallback(async (id: string) => {
    const ok = await showCustomConfirm("确定删除这个自定义预设指令组件吗？");
    if (!ok) return;
    const list = settings.promptConfig.customPrompts || [];
    const updated = list.filter((item) => item.id !== id);
    updateSettings({
      ...settings,
      promptConfig: { ...settings.promptConfig, customPrompts: updated },
    });
  }, [showCustomConfirm, settings, updateSettings]);

  return {
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
  };
};
