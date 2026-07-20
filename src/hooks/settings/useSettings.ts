import React, { useState, useCallback } from "react";
import { UserSettings, LorebookEntry, CustomWorldbook } from "../../types";
import { useApp } from "../../contexts/AppContext";
import { useChatState } from "../../contexts/ChatContext";
import { DEFAULT_SETTINGS } from "./defaults";
import { useSettingsLoader } from "./useSettingsLoader";
import { useSettingsPersistence } from "./useSettingsPersistence";
import { useApiConnection } from "./useApiConnection";
import { usePresetBundles } from "./usePresetBundles";
import { useCustomPrompts } from "./useCustomPrompts";
import { useBackupRestore } from "./useBackupRestore";
import { usePersonaManager } from "./usePersonaManager";

/**
 * useSettings 组合根 Hook。
 *
 * 作为上帝 Hook 的解耦聚合点：声明全部共享 state，并将各职责子 Hook 装配在一起，
 * 最终返回与原 useSettings 完全一致结构的公共 API，确保外部消费者零感知。
 *
 * 子 Hook 拆分（均位于 src/hooks/settings/）：
 * - useSettingsLoader      设置加载与预设注入迁移
 * - useSettingsPersistence 持久化 / 防抖保存 / 世界书写入
 * - useApiConnection       模型拉取与连接测试
 * - usePresetBundles       预设包导入/导出/保存/加载/删除
 * - useCustomPrompts       自定义提示词增删改
 * - useBackupRestore       备份导出/导入与 SillyChat 历史导入
 * - usePersonaManager      玩家人设切换/新增/删除
 */
export const useSettings = () => {
  const { showCustomAlert, showCustomConfirm, showCustomPrompt } = useApp();
  const { setAvailableModels, setIsFetchingModels, setConnectionStatus } = useChatState();

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [globalLorebook, setGlobalLorebook] = useState<LorebookEntry[]>([]);
  const [customWorldbooks, setCustomWorldbooks] = useState<Record<string, CustomWorldbook>>({});
  const [isReady, setIsReady] = useState(false);

  // Backups Encryption Passphrase
  const [backupPass, setBackupPass] = useState("");
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [showBackupUI, setShowBackupUI] = useState(false);

  // Collapsible configuration panels (Accordion structure starts with "api" open)
  const [activeSettingAccordion, setActiveSettingAccordion] = useState<string | null>("api");
  const [sillyInnerTab, setSillyInnerTab] = useState<"samplers" | "prompts">("samplers");
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());

  const togglePromptExpanded = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 1. 设置加载（仅挂载时执行一次）
  useSettingsLoader({
    setSettings,
    setGlobalLorebook,
    setCustomWorldbooks,
    setIsReady,
  });

  // 2. 持久化 / 防抖保存 / 世界书写入
  const {
    updateSettings,
    updateGlobalLorebook,
    updateCustomWorldbooks,
    settingsSaveState,
    settingsLastSavedAt,
  } = useSettingsPersistence({
    settings,
    setSettings,
    setGlobalLorebook,
    setCustomWorldbooks,
    isReady,
    showCustomAlert,
  });

  // 3. 模型拉取与连接测试
  const { handleFetchModels, testApiConnection } = useApiConnection({
    settings,
    updateSettings,
    setAvailableModels,
    setIsFetchingModels,
    setConnectionStatus,
  });

  // 4. 预设包管理
  const {
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
  } = usePresetBundles({
    settings,
    updateSettings,
    showCustomAlert,
    showCustomPrompt,
    showCustomConfirm,
  });

  // 5. 自定义提示词管理
  const {
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
  } = useCustomPrompts({
    settings,
    updateSettings,
    setExpandedPromptIds,
    showCustomConfirm,
  });

  // 6. 备份导入/导出与聊天记录导入
  const {
    handleExportLocalDataBackup,
    handleImportLocalDataBackup,
    handleImportSillyChatHistory,
    handleSilentDailyBackup,
  } = useBackupRestore({
    settings,
    globalLorebook,
    setSettings,
    setGlobalLorebook,
    backupPass,
    encryptBackup,
    setBackupStatus,
    showCustomAlert,
    showCustomConfirm,
  });

  // 7. 玩家人设管理
  const { switchUserPersona, addUserPersona, deleteUserPersona } = usePersonaManager({
    settings,
    updateSettings,
    showCustomAlert,
    showCustomPrompt,
    showCustomConfirm,
  });

  return {
    switchUserPersona,
    addUserPersona,
    deleteUserPersona,
    settings,
    setSettings,
    updateSettings,
    settingsSaveState,
    settingsLastSavedAt,
    globalLorebook,
    setGlobalLorebook,
    updateGlobalLorebook,
    isReady,
    handleFetchModels,
    testApiConnection,
    handleImportPresetJSON,
    handleExportPresetJSON,
    handleSaveNewPresetBundle,
    handleLoadPresetBundle,
    handleDeletePresetBundle,
    handleDeletePresetBundles,
    handleToggleCustomPrompt,
    handleUpdateCustomPrompt,
    handleAddNewCustomPrompt,
    handleDeleteCustomPrompt,
    backupPass,
    setBackupPass,
    backupStatus,
    setBackupStatus,
    encryptBackup,
    setEncryptBackup,
    showBackupUI,
    setShowBackupUI,
    activeSettingAccordion,
    setActiveSettingAccordion,
    sillyInnerTab,
    setSillyInnerTab,
    expandedPromptIds,
    setExpandedPromptIds,
    togglePromptExpanded,
    handleExportLocalDataBackup,
    handleImportLocalDataBackup,
    handleImportSillyChatHistory,
    handleSilentDailyBackup,
    customWorldbooks,
    updateCustomWorldbooks,
  };
};
