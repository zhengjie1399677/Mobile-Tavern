import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserSettings, LorebookEntry, CustomWorldbook } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import {
  ISettingsService,
  IWorldbookService,
} from "../../kernel/types";
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
  settingsSaveState: SettingsSaveState;
  settingsLastSavedAt?: number;
}

export type SettingsSaveState = "idle" | "pending" | "saving" | "saved" | "error";

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
  const kernel = useKernel();
  const settingsService = kernel.getService<ISettingsService<UserSettings>>("settings");
  const worldbookService = kernel.getService<IWorldbookService>("worldbook");

  // Debounced settings save to prevent locking IndexedDB on sliders
  const saveTimeoutRef = useRef<any>(null);
  const isWritingRef = useRef<boolean>(false);
  const pendingSettingsRef = useRef<UserSettings | null>(null);
  const latestSettingsRef = useRef(settings);
  const performSaveRef = useRef<(data: UserSettings) => Promise<void>>(async () => undefined);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("idle");
  const [settingsLastSavedAt, setSettingsLastSavedAt] = useState<number>();
  const settingsSaveStateRef = useRef<SettingsSaveState>("idle");
  settingsSaveStateRef.current = settingsSaveState;

  const performSave = useCallback(async (data: UserSettings) => {
    if (isWritingRef.current) {
      pendingSettingsRef.current = data;
      setSettingsSaveState("pending");
      return;
    }
    isWritingRef.current = true;
    setSettingsSaveState("saving");
    try {
      const cleanData = { ...data };
      delete cleanData.savedPresets; // Exclude preset arrays to prevent database bloat and I/O lag
      await settingsService.saveStoredSettings(cleanData);
      setSettingsLastSavedAt(Date.now());
      setSettingsSaveState(pendingSettingsRef.current ? "pending" : "saved");
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSettingsSaveState("error");
    } finally {
      isWritingRef.current = false;
      if (pendingSettingsRef.current) {
        const nextToSave = pendingSettingsRef.current;
        pendingSettingsRef.current = null;
        void performSaveRef.current(nextToSave);
      }
    }
  }, [settingsService]);
  performSaveRef.current = performSave;

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
    latestSettingsRef.current = settings;
    if (!isReady) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    pendingSettingsRef.current = settings;
    setSettingsSaveState("pending");
    saveTimeoutRef.current = setTimeout(() => {
      const nextToSave = pendingSettingsRef.current ?? settings;
      pendingSettingsRef.current = null;
      if (isWritingRef.current) {
        pendingSettingsRef.current = nextToSave;
      } else {
        void performSaveRef.current(nextToSave);
      }
    }, 400);
  }, [settings, isReady]);

  // 页面隐藏时立即发起最后一次写入；浏览器真正离开且仍未落盘时显示原生确认。
  useEffect(() => {
    const flushPending = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (isReady && (settingsSaveStateRef.current === "pending" || settingsSaveStateRef.current === "error")) {
        const nextToSave = pendingSettingsRef.current ?? latestSettingsRef.current;
        pendingSettingsRef.current = null;
        void performSaveRef.current(nextToSave);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (settingsSaveStateRef.current !== "pending" && settingsSaveStateRef.current !== "saving" && settingsSaveStateRef.current !== "error") return;
      flushPending();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isReady]);

  const updateGlobalLorebook = useCallback(async (entries: LorebookEntry[]) => {
    const cleaned = entries.map(cleanLorebookEntry);
    setGlobalLorebook(cleaned);
    try {
      await worldbookService.saveGlobalLorebook(cleaned);
    } catch (err) {
      console.error("Failed to save global lorebook:", err);
      showCustomAlert("保存全局世界书失败");
    }
  }, [showCustomAlert, setGlobalLorebook, worldbookService]);

  const updateCustomWorldbooks = useCallback(async (
    updater: Record<string, CustomWorldbook> | ((prev: Record<string, CustomWorldbook>) => Record<string, CustomWorldbook>)
  ) => {
    setCustomWorldbooks((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      worldbookService.saveCustomWorldbooks(next).catch((err) => {
        console.error("Failed to save custom worldbooks:", err);
      });
      return next;
    });
  }, [setCustomWorldbooks, worldbookService]);

  return {
    performSave,
    updateSettings,
    updateGlobalLorebook,
    updateCustomWorldbooks,
    settingsSaveState,
    settingsLastSavedAt,
  };
};
