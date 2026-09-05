import type * as React from "react";
import { useCallback } from "react";
import type { CustomPromptBlock, UserSettings } from "../../types";
import type { PromptBlock } from "../../domain/prompt-composition";
import { matchesPromptBlockReference } from "../../application/useCases/promptConfigBlockSync";

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
    role: CustomPromptBlock["role"],
    content: string
  ) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
}

/**
 * 自定义提示词管理子 Hook。
 *
 * 负责提示词模组的启用/禁用切换、内容更新、新增与删除，并与自由编排 composition.blocks 保持双向同步。
 */
export const useCustomPrompts = ({
  updateSettings,
  setExpandedPromptIds,
  showCustomConfirm,
}: UseCustomPromptsDeps): UseCustomPromptsReturn => {
  const handleToggleCustomPrompt = useCallback((id: string, enabled: boolean) => {
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const targetItem = list.find((item) => item.id === id);
      const updatedList = list.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      );

      const nextPromptConfig = {
        ...prev.promptConfig,
        customPrompts: updatedList,
      };

      if (prev.promptConfig.composition?.blocks) {
        nextPromptConfig.composition = {
          ...prev.promptConfig.composition,
          blocks: prev.promptConfig.composition.blocks.map((b) =>
            matchesPromptBlockReference(b, targetItem ?? { id }) ? { ...b, enabled } : b
          ),
        };
      }

      return {
        ...prev,
        promptConfig: nextPromptConfig,
      };
    });
  }, [updateSettings]);

  const handleUpdateCustomPrompt = useCallback((
    id: string,
    name: string,
    _role: CustomPromptBlock["role"],
    content: string,
  ) => {
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const targetItem = list.find((item) => item.id === id);
      const updatedList = list.map((item) =>
        item.id === id ? { ...item, name, role: "system" as const, content } : item,
      );

      const nextPromptConfig = {
        ...prev.promptConfig,
        customPrompts: updatedList,
      };

      if (prev.promptConfig.composition?.blocks) {
        nextPromptConfig.composition = {
          ...prev.promptConfig.composition,
          blocks: prev.promptConfig.composition.blocks.map((b) =>
            matchesPromptBlockReference(b, targetItem ?? { id })
              ? { ...b, name, ...(targetItem && content !== targetItem.content ? { template: content } : {}) }
              : b
          ),
        };
      }

      return {
        ...prev,
        promptConfig: nextPromptConfig,
      };
    });
  }, [updateSettings]);

  const handleAddNewCustomPrompt = useCallback(() => {
    const newId = "comp_" + Math.random().toString(36).substring(2, 9);
    setExpandedPromptIds((prev) => new Set(prev).add(newId));

    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const newItem: CustomPromptBlock = {
        id: newId,
        identifier: newId,
        name: `新预设指令或文风约束_${list.length + 1}`,
        role: "system" as const,
        content: "",
        enabled: true,
      };

      const nextPromptConfig = {
        ...prev.promptConfig,
        customPrompts: [...list, newItem],
      };

      if (prev.promptConfig.composition?.blocks) {
        const lastOrder = prev.promptConfig.composition.blocks.reduce(
          (max, b) => Math.max(max, b.order ?? 0),
          0
        );
        const newBlock: PromptBlock = {
          id: `block_${newId}`,
          name: newItem.name,
          enabled: true,
          role: "system",
          source: { type: "template" },
          template: "",
          order: lastOrder + 100,
          placement: { type: "ordered" },
          compatibility: {
            source: "mobile-tavern",
            originalIdentifier: newId,
          },
        };
        nextPromptConfig.composition = {
          ...prev.promptConfig.composition,
          blocks: [...prev.promptConfig.composition.blocks, newBlock],
        };
      }

      return {
        ...prev,
        promptConfig: nextPromptConfig,
      };
    });
  }, [setExpandedPromptIds, updateSettings]);

  const handleDeleteCustomPrompt = useCallback(async (id: string) => {
    const ok = await showCustomConfirm("确定删除这个自定义预设指令组件吗？");
    if (!ok) return;

    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const targetItem = list.find((item) => item.id === id);
      const updatedList = list.filter((item) => item.id !== id);

      const nextPromptConfig = {
        ...prev.promptConfig,
        customPrompts: updatedList,
      };

      if (prev.promptConfig.composition?.blocks) {
        nextPromptConfig.composition = {
          ...prev.promptConfig.composition,
          blocks: prev.promptConfig.composition.blocks.filter(
            (b) => !matchesPromptBlockReference(b, targetItem ?? { id })
          ),
        };
      }

      return {
        ...prev,
        promptConfig: nextPromptConfig,
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
