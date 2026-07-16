import React, { useRef } from "react";
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

/**
 * ⚠️ 命名说明：此文件名中的 "Legacy" 具有历史误导性，实际上这是应用的核心 Provider 组装层。
 *
 * 职责：
 * 1. 嵌套挂载所有分离的 Context Provider（AppProvider / CharacterProvider / ChatProvider）
 * 2. 在内层 Inner 组件中调用所有业务 Hook（useSettings / useCharacters / useChat）
 * 3. 将来自多个 context 和 hook 的状态合并为统一 the AppContext 值，供全局消费
 * 4. 通过 useMemo 对 characters 按最近聊天时间排序，避免在下游组件重复计算
 *
 * 如需重命名，建议改为 AppContextAssembler.tsx 或 UnifiedAppProvider.tsx。
 * 当前暂不重命名，以免引入大规模 import 路径变更风险。
 */

export {
  DEFAULT_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
} from "../hooks/useSettings";

export const LegacyAppContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <AppProvider>
      <CharacterProvider>
        <ChatProvider>
          <LegacyAppContextProviderInner>{children}</LegacyAppContextProviderInner>
        </ChatProvider>
      </CharacterProvider>
    </AppProvider>
  );
};

function LegacyAppContextProviderInner({ children }: { children: React.ReactNode }) {
  const kernel = useKernel();

  // Usage telemetry tracking hook
  useUsageTracking();

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
    settingsHook.customWorldbooks
  );

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
  ]);

  // 仅在首次渲染且 store 尚未初始化时同步写入，防止下游子组件在初次挂载时由于解构空对象而崩溃
  if (Object.keys(unifiedAppStore.getState()).length === 0) {
    unifiedAppStore.setRawState(appContextValue);
  }

  React.useEffect(() => {
    // 渲染完成后，调用自带属性级浅比较的 setState 更新外部 store 并通知精确订阅的子组件
    unifiedAppStore.setState(appContextValue);
  }, [appContextValue]);

  // 使用 ref 存储最新的备份函数与角色数据，避免它们作为定时器依赖导致频繁重置
  const silentDailyBackupRef = React.useRef(settingsHook.handleSilentDailyBackup);
  silentDailyBackupRef.current = settingsHook.handleSilentDailyBackup;
  const backupCharactersRef = React.useRef(charState.characters);
  backupCharactersRef.current = charState.characters;

  // 每日后台自动备份定时器，在应用就绪 5 秒后静默检测并执行
  // 依赖数组仅保留就绪标志，避免活跃聊天时 sessions/characters 变化不断重置 5 秒定时器
  React.useEffect(() => {
    if (!settingsHook.isReady || !charState.isDBReady) return;

    const timer = setTimeout(() => {
      console.log("[AutoBackup] App state is ready. Triggering daily backup check...");
      silentDailyBackupRef.current(
        backupCharactersRef.current
      ).catch((err) => {
        console.error("[AutoBackup] Background daily backup scheduler failed:", err);
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, [
    settingsHook.isReady,
    charState.isDBReady,
  ]);

  return (
    <UnifiedAppContext.Provider value={appContextValue}>
      {children}
    </UnifiedAppContext.Provider>
  );
}
