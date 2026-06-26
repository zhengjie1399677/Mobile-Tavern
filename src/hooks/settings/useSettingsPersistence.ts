import type * as React from "react";
import { useCallback, useEffect, useRef } from "react";
import { UserSettings, LorebookEntry, CustomWorldbook } from "../../types";
import {
  saveStoredSettings,
  saveGlobalLorebook as dbSaveGlobalLorebook,
  saveCustomWorldbooks,
} from "../../utils/localDB";
import { getNestedDelta, deepMerge, cleanLorebookEntry } from "./mergeUtils";

interface UseSettingsPersistenceDeps {
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  setCustomWorldbooks: React.Dispatch<React.SetStateAction<Record<string, CustomWorldbook>>>;
  isReady: boolean;
  showCustomAlert: (msg: string, title?: string) => Promise<void> | void;
}

interface UseSettingsPersistenceReturn {
  performSave: (data: UserSettings) => Promise<void>;
  updateSettings: (
    updater: UserSettings | ((prev: UserSettings) => UserSettings)
  ) => void;
  updateGlobalLorebook: (entries: LorebookEntry[]) => Promise<void>;
  updateCustomWorldbooks: (
    updater:
      | Record<string, CustomWorldbook>
      | ((prev: Record<string, CustomWorldbook>) => Record<string, CustomWorldbook>)
  ) => Promise<void>;
}

/**
 * 设置持久化子 Hook。
 *
 * 负责：
 * - performSave：将设置写入 IndexedDB（剔除 savedPresets 数组以减小 I/O 负担），支持写入队列串行化
 * - updateSettings：合并增量更新并同步活跃人设属性
 * - 防抖保存 effect（400ms 延迟，避免滑块拖动锁死 IndexedDB）
 * - updateGlobalLorebook / updateCustomWorldbooks：世界书与自定义世界书的写入
 */
export const useSettingsPersistence = ({
  settings,
  setSettings,
  setGlobalLorebook,
  setCustomWorldbooks,
  isReady,
  showCustomAlert,
}: UseSettingsPersistenceDeps): UseSettingsPersistenceReturn => {
  // Debounced settings save to prevent locking IndexedDB on sliders
  const saveTimeoutRef = useRef<any>(null);
  const isWritingRef = useRef<boolean>(false);
  const pendingSettingsRef = useRef<UserSettings | null>(null);

  const performSave = async (data: UserSettings) => {
    isWritingRef.current = true;
    try {
      const cleanData = { ...data };
      delete cleanData.savedPresets; // Exclude preset arrays to prevent database bloat and I/O lag
      await saveStoredSettings(cleanData);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      isWritingRef.current = false;
      if (pendingSettingsRef.current) {
        const nextToSave = pendingSettingsRef.current;
        pendingSettingsRef.current = null;
        performSave(nextToSave);
      }
    }
  };

  const updateSettings = useCallback((updater: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    setSettings((prev) => {
      let merged: UserSettings;
      if (typeof updater === "function") {
        const next = updater(prev);
        if (!next) return prev;
        // 如果是函数式 updater，直接使用其返回的最新 settings 对象，不再执行复杂的 deepMerge
        // 这样可以规避 deepMerge 内部复杂的合并逻辑和引用相同问题，确保 100% 触发 React 状态重绘
        merged = next;
      } else {
        const next = updater;
        if (!next) return prev;

        // Compare next with base settings in this render closure to extract custom changes
        const delta = getNestedDelta(next, settings);
        if (!delta) return prev;
        merged = deepMerge(prev, delta);
      }

      // 同步当前活跃的 persona 属性
      const activeId = merged.activePersonaId || "default-persona";
      const personas = merged.userPersonas || [];
      if (personas.length > 0) {
        const idx = personas.findIndex((p: any) => p.id === activeId);
        if (idx !== -1) {
          const activePers = { ...personas[idx] };
          let changed = false;
          if (merged.userName !== undefined && merged.userName !== activePers.name) {
            activePers.name = merged.userName;
            changed = true;
          }
          if (merged.userAvatar !== undefined && merged.userAvatar !== activePers.avatar) {
            activePers.avatar = merged.userAvatar;
            changed = true;
          }
          if (merged.userInfo !== undefined && merged.userInfo !== activePers.description) {
            activePers.description = merged.userInfo;
            changed = true;
          }
          if (changed) {
            const nextPersonas = [...personas];
            nextPersonas[idx] = activePers;
            merged.userPersonas = nextPersonas;
          }
        }
      }

      return merged;
    });
  }, [settings]);

  // Debounced settings save to prevent locking IndexedDB on sliders
  useEffect(() => {
    if (!isReady) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      if (isWritingRef.current) {
        pendingSettingsRef.current = settings;
      } else {
        performSave(settings);
      }
    }, 400);
  }, [settings, isReady]);

  // Cleanup save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const updateGlobalLorebook = useCallback(async (entries: LorebookEntry[]) => {
    const cleaned = entries.map(cleanLorebookEntry);
    setGlobalLorebook(cleaned);
    try {
      await dbSaveGlobalLorebook(cleaned);
    } catch (err) {
      console.error("Failed to save global lorebook:", err);
      showCustomAlert("保存全局世界书失败");
    }
  }, [showCustomAlert, setGlobalLorebook]);

  const updateCustomWorldbooks = useCallback(async (
    updater: Record<string, CustomWorldbook> | ((prev: Record<string, CustomWorldbook>) => Record<string, CustomWorldbook>)
  ) => {
    setCustomWorldbooks((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveCustomWorldbooks(next).catch((err) => {
        console.error("Failed to save custom worldbooks:", err);
      });
      return next;
    });
  }, [setCustomWorldbooks]);

  return { performSave, updateSettings, updateGlobalLorebook, updateCustomWorldbooks };
};
