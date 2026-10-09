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
    role: "system" | "user" | "assistant",
    content: string,
  ) => {
    updateSettings((prev) => {
      const list = prev.promptConfig.customPrompts || [];
      const updated = list.map((item) => {
        // 身份优先用 id：`identifier` 只是没有 id 时的兼容别名。
        // 两者混用会让"同 identifier 的另一条"被一并改写（SillyTavern 复制条目会带出重复 identifier）。
        const matches = item.id ? item.id === id : Boolean(item.identifier) && item.identifier === id;
        return matches ? { ...item, id: item.id || id, name, role, content } : item;
      });
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
        name: `新提示词模组_${list.length + 1}`,
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

  /**
   * 列表侧删除。
   *
   * 必须连带删除同源的编排区块：只删列表会让条目在编排模式下既不生效、又和已被删掉的区块对不上。
   * 编排侧若开着编辑器仍可从它的撤销栈整份还原，列表侧本身不提供撤销。
   */
  const handleDeleteCustomPrompt = useCallback(async (id: string) => {
    const ok = await showCustomConfirm("确定删除这个自定义提示词模组吗？");
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
