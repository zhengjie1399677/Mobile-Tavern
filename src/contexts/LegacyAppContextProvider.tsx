import React, { useRef } from "react";
import { AppContext } from "../AppContext";
import { AppProvider, useApp } from "./AppContext";
import { CharacterProvider, useCharactersState } from "./CharacterContext";
import { ChatProvider, useChatState } from "./ChatContext";
import { useSettings } from "../hooks/useSettings";
import { useCharacters } from "../hooks/useCharacters";
import { useChat } from "../hooks/useChat";
import { useUsageTracking } from "../utils/useUsageTracking";
import { SamplerPreset, PromptConfig, UserSettings } from "../types";

export {
  DEFAULT_PRESETS,
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
  const chatHook = useChat(settingsHook.settings, settingsHook.globalLorebook, chatBottomRef);

  // Wrap handleDeleteCharacter to inject chatState dependencies
  const wrappedHandleDeleteCharacter = React.useCallback(async (id: string, e: React.MouseEvent) => {
    return charactersHook.handleDeleteCharacter(
      id,
      e,
      chatState.sessions,
      chatState.setSessions,
      chatState.deleteSession
    );
  }, [charactersHook, chatState.sessions, chatState.setSessions, chatState.deleteSession]);

  // Wrap backup exports to inject current characters and sessions states
  const wrappedHandleExportLocalDataBackup = React.useCallback(async () => {
    return settingsHook.handleExportLocalDataBackup(
      charState.characters,
      chatState.sessions
    );
  }, [settingsHook, charState.characters, chatState.sessions]);

  // Wrap backup imports to inject state dispatch actions
  const wrappedHandleImportLocalDataBackup = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    return settingsHook.handleImportLocalDataBackup(
      e,
      charState.setCharacters,
      chatState.setSessions
    );
  }, [settingsHook, charState.setCharacters, chatState.setSessions]);

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
  ]);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}
