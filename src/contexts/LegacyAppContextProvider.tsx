import React, { useCallback, useEffect, useRef, useState } from "react";
import { UnifiedAppContext, unifiedAppStore } from "../UnifiedAppContext";
import { AppProvider, useApp } from "./AppContext";
import { CharacterProvider, useCharactersState } from "./CharacterContext";
import { ChatProvider, useChatState } from "./ChatContext";
import { useSettings } from "../hooks/useSettings";
import { useCharacters } from "../hooks/useCharacters";
import { useChat } from "../hooks/useChat";
import { useUsageTracking } from "../utils/useUsageTracking";
import { SamplerPreset, PromptConfig, UserSettings } from "../types";
import { useKernel } from "./KernelContext";
import type { InstalledFullscreenPlugin } from "../domain/plugins";

const RUNNING_PLUGIN_SESSION_KEY = "mobile-tavern.running-fullscreen-plugin";

function readRunningPluginId(): string | undefined {
  try {
    return window.sessionStorage.getItem(RUNNING_PLUGIN_SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function setRunningPluginId(pluginId?: string): void {
  try {
    if (pluginId) window.sessionStorage.setItem(RUNNING_PLUGIN_SESSION_KEY, pluginId);
    else window.sessionStorage.removeItem(RUNNING_PLUGIN_SESSION_KEY);
  } catch {
    // 会话存储不可用时，保持原有的内存态行为。
  }
}

/**
 * 应用 Context 组合器。文件名保留是为了兼容历史导入路径，新代码应使用 AppContextAssembler。
 *
 * 职责：
 * 1. 嵌套挂载所有分离的 Context Provider（AppProvider / CharacterProvider / ChatProvider）
 * 2. 在内层 Inner 组件中调用所有业务 Hook（useSettings / useCharacters / useChat）
 * 3. 将来自多个 context 和 hook 的状态合并为统一 the AppContext 值，供全局消费
 * 4. 通过 useMemo 对 characters 按最近聊天时间排序，避免在下游组件重复计算
 *
 * LegacyAppContextProvider 仅作为旧名称兼容别名保留。
 */

export {
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
} from "../hooks/useSettings";

export const AppContextAssembler: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AppProvider>
      <CharacterProvider>
        <ChatProvider>
          <AppContextAssemblerInner>{children}</AppContextAssemblerInner>
        </ChatProvider>
      </CharacterProvider>
    </AppProvider>
  );
};

/** @deprecated 请使用 AppContextAssembler。 */
export const LegacyAppContextProvider = AppContextAssembler;

function AppContextAssemblerInner({ children }: { children: React.ReactNode }) {
  const kernel = useKernel();

  // Usage telemetry tracking hook
  useUsageTracking();

  // --- 全屏插件运行态（提升到全局，由 App 顶层渲染 FullscreenPluginRunner）---
  const [runningPlugin, setRunningPlugin] = useState<InstalledFullscreenPlugin | undefined>(undefined);

  const launchPlugin = useCallback((plugin: InstalledFullscreenPlugin) => {
    setRunningPluginId(plugin.id);
    setRunningPlugin(plugin);
  }, []);

  const exitPlugin = useCallback(() => {
    setRunningPluginId();
    setRunningPlugin(undefined);
  }, []);

  // 刷新恢复：首次挂载时若 sessionStorage 标记了正在运行的插件，按 ID 解析并恢复运行态。
  // 复用 selectCharacter 的插件分支（通过 chatHook 在下方挂载后调用）。
  const restorePluginId = useRef<string | undefined>(undefined);

  // 1. AppContext State & Triggers
  const appState = useApp();

  // 2. CharacterContext State & CRUD
  const charState = useCharactersState();

  // 3. ChatContext State & CRUD
  const chatState = useChatState();

  // 4. useSettings Hook
  const settingsHook = useSettings();

  // 5. useCharacters Hook
  const charactersHook = useCharacters();

  // 6. Ref for scroll & useChat Hook
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatHook = useChat(
    settingsHook.settings,
    settingsHook.globalLorebook,
    chatBottomRef,
    settingsHook.customWorldbooks,
    launchPlugin
  );

  // 刷新恢复 effect：在 chatHook 装配后首次挂载触发，借 selectCharacter 的插件分支解析并启动。
  useEffect(() => {
    if (restorePluginId.current) return;
    const pluginId = readRunningPluginId();
    if (!pluginId) return;
    restorePluginId.current = pluginId;
    void chatHook.selectCharacter(`plugin:${pluginId}`).catch((err) => {
      console.warn("[AppContextAssembler] Failed to restore running plugin:", err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHook.selectCharacter]);

  // Wrap handleDeleteCharacter to inject chatState dependencies
  const wrappedHandleDeleteCharacter = React.useCallback(async (id: string, e: React.MouseEvent) => {
    chatHook.handleStopGeneration();
    return charactersHook.handleDeleteCharacter(
      id,
      e,
      chatState.sessions,
      chatState.setSessions,
      chatState.deleteSession
    );
  }, [chatHook, charactersHook, chatState.sessions, chatState.setSessions, chatState.deleteSession]);

  // Wrap backup exports to inject current characters state
  const wrappedHandleExportLocalDataBackup = React.useCallback(async () => {
    return settingsHook.handleExportLocalDataBackup(
      charState.characters
    );
  }, [settingsHook, charState.characters]);

  // Wrap backup imports to inject state dispatch actions
  const wrappedHandleImportLocalDataBackup = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    return settingsHook.handleImportLocalDataBackup(
      e,
      charState.setCharacters,
      chatState.setSessions
    );
  }, [settingsHook, charState.setCharacters, chatState.setSessions]);

  // Wrap SillyTavern chat history import
  const wrappedHandleImportSillyChatHistory = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    return settingsHook.handleImportSillyChatHistory(
      e,
      charState.characters,
      chatState.setSessions
    );
  }, [settingsHook, charState.characters, chatState.setSessions]);

  // Wrap silent daily backup to inject characters state
  const wrappedHandleSilentDailyBackup = React.useCallback(async () => {
    return settingsHook.handleSilentDailyBackup(
      charState.characters
    );
  }, [settingsHook, charState.characters]);

  // Sort characters by their last active conversation time (latest message timestamp across all sessions) descending.
  const sortedCharacters = React.useMemo(() => {
    const getCharLastActiveTime = (charId: string) => {
      const charSessions = chatState.sessions.filter(s => s.characterId === charId);
      if (charSessions.length === 0) return 0;
      return charSessions.reduce((max, s) => {
        const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
        const sTime = lastMsg ? (lastMsg.timestamp || s.createdAt) : s.createdAt;
        return Math.max(max, sTime);
      }, 0);
    };

    return [...charState.characters].sort((a, b) => {
      const aTime = getCharLastActiveTime(a.id);
      const bTime = getCharLastActiveTime(b.id);
      if (bTime !== aTime) {
        return bTime - aTime;
      }
      return a.name.localeCompare(b.name);
    });
  }, [charState.characters, chatState.sessions]);

  const appContextValue = React.useMemo(() => ({
    // Context States
    ...appState,
    ...charState,
    characters: sortedCharacters,
    ...chatState,

    // Settings Hook
    ...settingsHook,

    // Characters Hook
    ...charactersHook,

    // Chat Hook
    ...chatHook,
    chatBottomRef,

    // Overrides with wrapped functions to resolve argument missing bugs
    handleDeleteCharacter: wrappedHandleDeleteCharacter,
    handleExportLocalDataBackup: wrappedHandleExportLocalDataBackup,
    handleImportLocalDataBackup: wrappedHandleImportLocalDataBackup,
    handleImportSillyChatHistory: wrappedHandleImportSillyChatHistory,
    handleSilentDailyBackup: wrappedHandleSilentDailyBackup,

    // 封装内核服务访问，代替组件内直接 import globalKernel
    getKernelService: kernel.getService.bind(kernel),

    // 全屏插件运行态
    runningPlugin,
    launchPlugin,
    exitPlugin,
  }), [
    appState,
    charState,
    sortedCharacters,
    chatState,
    settingsHook,
    charactersHook,
    chatHook,
    wrappedHandleDeleteCharacter,
    wrappedHandleExportLocalDataBackup,
    wrappedHandleImportLocalDataBackup,
    wrappedHandleImportSillyChatHistory,
    wrappedHandleSilentDailyBackup,
    kernel,
    runningPlugin,
    launchPlugin,
    exitPlugin,
  ]);

  // 仅在首次渲染且 store 尚未初始化时同步写入，防止下游子组件在初次挂载时由于解构空对象而崩溃
  if (Object.keys(unifiedAppStore.getState()).length === 0) {
    unifiedAppStore.setRawState(appContextValue);
  }

  React.useEffect(() => {
    // 渲染完成后，调用自带属性级浅比较的 setState 更新外部 store 并通知精确订阅的子组件
    unifiedAppStore.setState(appContextValue);
  }, [appContextValue]);

  return (
    <UnifiedAppContext.Provider value={appContextValue}>
      {children}
    </UnifiedAppContext.Provider>
  );
}
