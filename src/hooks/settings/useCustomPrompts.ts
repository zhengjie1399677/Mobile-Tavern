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
    role: "system" | "user" | "assistant",
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
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const updated = list.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      );
      return {
        ...prev,
        promptConfig: { ...prev.promptConfig, customPrompts: updated },
      };
    });
  }, [updateSettings]);

  const handleUpdateCustomPrompt = useCallback((
    id: string,
    name: string,
    role: "system" | "user" | "assistant",
    content: string,
  ) => {
    // 现行实现统一把提示词区块写作 system 角色；`role` 参数保留为调用方签名，
    // 实际写入值见下方 `role: "system"`（角色归一化由出厂迁移负责）。
    void role;
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const updated = list.map((item) =>
        item.id === id ? { ...item, name, role: "system" as const, content } : item,
      );
      return {
        ...prev,
        promptConfig: { ...prev.promptConfig, customPrompts: updated },
      };
    });
  }, [updateSettings]);

  const handleAddNewCustomPrompt = useCallback(() => {
    const newId = "comp_" + Math.random().toString(36).substring(2, 9);
    setExpandedPromptIds((prev) => new Set(prev).add(newId));

    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const newItem = {
        id: newId,
        name: `新预设指令或文风约束_${list.length + 1}`,
        role: "system" as const,
        content: "",
        enabled: true,
      };
      return {
        ...prev,
        promptConfig: {
          ...prev.promptConfig,
          customPrompts: [...list, newItem],
        },
      };
    });
  }, [setExpandedPromptIds, updateSettings]);

  const handleDeleteCustomPrompt = useCallback(async (id: string) => {
    const ok = await showCustomConfirm("确定删除这个自定义预设指令组件吗？");
    if (!ok) return;
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const updated = list.filter((item) => item.id !== id);
      return {
        ...prev,
        promptConfig: { ...prev.promptConfig, customPrompts: updated },
      };
    });
  }, [showCustomConfirm, updateSettings]);

  return {
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
  };
};
