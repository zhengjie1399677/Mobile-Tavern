import { useCallback } from "react";
import { UserSettings } from "../../types";

interface UsePersonaManagerDeps {
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

interface UsePersonaManagerReturn {
  switchUserPersona: (id: string) => void;
  addUserPersona: () => Promise<void>;
  deleteUserPersona: (id: string) => Promise<void>;
}

/**
 * 人设管理子 Hook。
 *
 * 负责玩家人物档的切换、新增与删除，并同步覆盖全局 userName / userAvatar / userInfo。
 */
export const usePersonaManager = ({
  settings,
  updateSettings,
  showCustomAlert,
  showCustomPrompt,
  showCustomConfirm,
}: UsePersonaManagerDeps): UsePersonaManagerReturn => {
  const switchUserPersona = useCallback((id: string) => {
    updateSettings((prev) => {
      const target = prev.userPersonas?.find(p => p.id === id);
      if (!target) return prev;
      return {
        ...prev,
        activePersonaId: id,
        userName: target.name || "",
        userAvatar: target.avatar || "",
        userInfo: target.description || "",
      };
    });
  }, [updateSettings]);

  const addUserPersona = useCallback(async () => {
    const name = await showCustomPrompt("请输入新人物名称:", "新人物");
    if (!name) return;
    const newId = "persona-" + Math.random().toString(36).substring(2, 9);
    updateSettings((prev) => {
      const newPers = {
        id: newId,
        name: name,
        avatar: "",
        description: "",
      };
      const personas = prev.userPersonas || [];
      return {
        ...prev,
        userPersonas: [...personas, newPers],
        activePersonaId: newId,
        userName: name,
        userAvatar: "",
        userInfo: "",
      };
    });
    await showCustomAlert(`成功创建并切换到人物: ${name}`);
  }, [updateSettings, showCustomPrompt, showCustomAlert]);

  const deleteUserPersona = useCallback(async (id: string) => {
    const target = settings.userPersonas?.find(p => p.id === id);
    if (!target) return;

    if ((settings.userPersonas || []).length <= 1) {
      await showCustomAlert("必须保留至少一个角色信息！");
      return;
    }

    const ok = await showCustomConfirm(`确定删除人物 "${target.name}" 吗？`);
    if (!ok) return;

    updateSettings((prev) => {
      const personas = prev.userPersonas || [];
      const nextPersonas = personas.filter(p => p.id !== id);
      const nextActive = nextPersonas[0];
      return {
        ...prev,
        userPersonas: nextPersonas,
        activePersonaId: nextActive.id,
        userName: nextActive.name,
        userAvatar: nextActive.avatar,
        userInfo: nextActive.description,
      };
    });
    await showCustomAlert(`成功删除人物: ${target.name}`);
  }, [settings.userPersonas, updateSettings, showCustomConfirm, showCustomAlert]);

  return { switchUserPersona, addUserPersona, deleteUserPersona };
};
