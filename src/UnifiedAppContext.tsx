import React, { useSyncExternalStore, useCallback } from "react";
import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
  Message,
  SummaryCard,
  CustomPromptBlock,
  CustomWorldbook,
} from "./types";
import {
  TabType,
  ThemeType,
  CustomDialogConfig,
} from "./contexts/AppContext";
import type { IKernelService } from "./kernel/types";
import type { RecalledMessage } from "./kernel/services/memory/types";

export interface UnifiedAppContextProps {
  // --- App State ---
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  activeWorldbookHostId: string | null;
  setActiveWorldbookHostId: (id: string | null) => void;
  currentTheme: ThemeType;
  handleThemeChange: (theme: ThemeType) => void;
  showSplash: boolean;
  setShowSplash: (show: boolean) => void;
  customDialog: CustomDialogConfig | null;
  setCustomDialog: (config: CustomDialogConfig | null) => void;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  showCustomConfirm: (message: string, title?: string) => Promise<boolean>;
  showCustomPrompt: (message: string, defaultValue?: string, title?: string, inputType?: "text" | "textarea") => Promise<string | null>;
  safeAreas: { top: number; bottom: number };

  // --- Character Context ---
  characters: CharacterCard[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterCard[]>>;
  activeCharId: string | null;
  setActiveCharId: (id: string | null) => void;
  activeCharacter: CharacterCard | null;
  isDBReady: boolean;
  setIsDBReady: (ready: boolean) => void;
  loadCharacters: () => Promise<void>;
  saveCharacter: (character: CharacterCard) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;

  // --- Chat Context ---
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  activeSession: ChatSession | null;
  isSending: boolean;
  setIsSending: (sending: boolean) => void;
  isSummarizing: boolean;
  setIsSummarizing: (summarizing: boolean) => void;
  availableModels: string[];
  setAvailableModels: (models: string[]) => void;
  isFetchingModels: boolean;
  setIsFetchingModels: (fetching: boolean) => void;
  connectionStatus: { testing: boolean; success?: boolean; message?: string };
  setConnectionStatus: (status: any) => void;
  loadSessions: () => Promise<void>;
  saveSession: (session: ChatSession) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  // TODO-4: 消息分页懒加载
  hasMoreMessages: boolean;
  isLoadingMoreMessages: boolean;
  loadMoreMessages: () => Promise<void>;

  // --- Settings Hook ---
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  globalLorebook: LorebookEntry[];
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  updateGlobalLorebook: (entries: LorebookEntry[]) => Promise<void>;
  switchUserPersona: (id: string) => void;
  addUserPersona: () => Promise<void>;
  deleteUserPersona: (id: string) => Promise<void>;
  isReady: boolean;
  handleFetchModels: () => Promise<void>;
  testApiConnection: () => Promise<void>;
  handleImportPresetJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPresetJSON: () => void;
  handleSaveNewPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => void;
  handleDeletePresetBundle: (presetId: string) => Promise<void>;
  handleDeletePresetBundles: (presetIds: string[]) => Promise<void>;
  handleToggleCustomPrompt: (id: string, enabled: boolean) => void;
  handleUpdateCustomPrompt: (id: string, name: string, role: any, content: string) => void;
  handleAddNewCustomPrompt: () => void;
  handleDeleteCustomPrompt: (id: string) => Promise<void>;
  backupPass: string;
  setBackupPass: (pass: string) => void;
  backupStatus: string;
  setBackupStatus: (status: string) => void;
  encryptBackup: boolean;
  setEncryptBackup: (encrypt: boolean) => void;
  showBackupUI: boolean;
  setShowBackupUI: (show: boolean) => void;
  activeSettingAccordion: string | null;
  setActiveSettingAccordion: (acc: string | null) => void;
  sillyInnerTab: "samplers" | "prompts";
  setSillyInnerTab: (tab: "samplers" | "prompts") => void;
  expandedPromptIds: Set<string>;
  setExpandedPromptIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  togglePromptExpanded: (id: string, e?: React.MouseEvent) => void;
  handleExportLocalDataBackup: () => Promise<void>;
  handleImportLocalDataBackup: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportSillyChatHistory: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleSilentDailyBackup: (characters: any[]) => Promise<boolean>;
  customWorldbooks: Record<string, CustomWorldbook>;
  updateCustomWorldbooks: (
    updater: Record<string, CustomWorldbook> | ((prev: Record<string, CustomWorldbook>) => Record<string, CustomWorldbook>)
  ) => Promise<void>;

  // --- Characters Hook ---
  handleImportCardFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportSillyLorebook: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportCharacterJSON: (char: CharacterCard) => void;
  handleExportCharacterPNG: (char: CharacterCard) => Promise<void>;
  charModalOpen: boolean;
  setCharModalOpen: (open: boolean) => void;
  editingChar: Partial<CharacterCard> | null;
  setEditingChar: (char: Partial<CharacterCard> | null) => void;
  isDbWriting: boolean;
  activeLoreTab: "detail" | "lore";
  setActiveLoreTab: (tab: "detail" | "lore") => void;
  editingLoreEntry: Partial<LorebookEntry> | null;
  setEditingLoreEntry: (entry: Partial<LorebookEntry> | null) => void;
  expandedLoreIds: Record<string, boolean>;
  setExpandedLoreIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingActiveCharLoreEntry: Partial<LorebookEntry> | null;
  setEditingActiveCharLoreEntry: (entry: Partial<LorebookEntry> | null) => void;
  handleAddNewCharacter: () => void;
  handleEditCharacter: (char: CharacterCard) => void;
  handleDeleteCharacter: (id: string, e: React.MouseEvent) => Promise<void>;
  handleSaveCharacter: () => Promise<void>;
  handleSaveLoreEntry: () => Promise<void>;
  handleSaveActiveCharLoreEntry: (activeCharacter: CharacterCard) => Promise<void>;

  // --- Chat Hook ---
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
  handleSendMessage: (textToSend: string, options?: { isBisonConsecutive?: boolean, skipAI?: boolean }) => Promise<void>;
  handleStartNewSession: (customFirstMessage?: string) => Promise<void>;
  triggerScroll: (behavior?: "smooth" | "instant" | "auto") => void;
  showSessionManager: boolean;
  setShowSessionManager: (show: boolean) => void;
  showFullHistory: boolean;
  setShowFullHistory: (show: boolean) => void;
  chatSubTab: "dialogue" | "timeline";
  setChatSubTab: (tab: "dialogue" | "timeline") => void;
  userInputMessage: string;
  setUserInputMessage: (msg: string) => void;
  replySuggestions: string[];
  setReplySuggestions: React.Dispatch<React.SetStateAction<string[]>>;
  editingMsgId: string | null;
  setEditingMsgId: (id: string | null) => void;
  editingMsgContent: string;
  setEditingMsgContent: (content: string) => void;
  msgMenuId: string | null;
  setMsgMenuId: (id: string | null) => void;
  timelineModalOpen: boolean;
  setTimelineModalOpen: (open: boolean) => void;
  newSummaryTag: string;
  setNewSummaryTag: (tag: string) => void;
  newSummaryLoc: string;
  setNewSummaryLoc: (loc: string) => void;
  newSummaryContent: string;
  setNewSummaryContent: (content: string) => void;
  editingSummaryId: string | null;
  setEditingSummaryId: (id: string | null) => void;
  handleRerollFromMessage: (targetMsg: Message) => Promise<void>;
  handleRerollLast: () => Promise<void>;
  handleAutoSummaryCheck: (session: ChatSession, force?: boolean) => Promise<void>;
  handleStopGeneration: () => void;
  createNewBranch: () => Promise<void>;
  deleteBranch: (id: string) => Promise<void>;
  selectCharacter: (charId: string) => Promise<void>;
  createBacktrackBranch: (msg: Message) => Promise<void>;
  createBacktrackFromTimeline: (summary: SummaryCard) => Promise<void>;
  handleAddTimelineSummary: () => Promise<void>;
  renderDialogueBubble: (text: string, messageIndex?: number, isStreaming?: boolean) => React.ReactNode;
  saveSessionWithMvu: (session: ChatSession, messageToParse?: string) => Promise<ChatSession>;
  isBisonLocking: boolean;
  /** 当前会话最近一次记忆召回的瞬态快照，不进入 ChatSession 持久化。 */
  lastRecalledMemories: RecalledMessage[];

  /**
   * 通过内核统一获取已注册服务，代替组件内直接 import { globalKernel }。
   * 内部代理到 KernelContext 当前实例的 getService，封装依赖来源并支持测试替换。
   */
  getKernelService: <T extends IKernelService>(name: string) => T;
}

export const UnifiedAppContext = React.createContext<UnifiedAppContextProps | null>(null);

function createStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getState = () => state;

  const setState = (nextState: T) => {
    let hasChanged = false;
    for (const key in nextState) {
      if (nextState[key] !== state[key]) {
        hasChanged = true;
        break;
      }
    }
    if (hasChanged) {
      state = nextState;
      listeners.forEach((l) => l());
    }
  };

  const setRawState = (nextState: T) => {
    state = nextState;
  };

  const notifyListeners = () => {
    listeners.forEach((l) => l());
  };

  function useStore<SelectorOutput>(selector: (state: T) => SelectorOutput): SelectorOutput {
    const lastStateRef = React.useRef<T | undefined>(undefined);
    const lastResultRef = React.useRef<SelectorOutput | undefined>(undefined);
    const hasInitRef = React.useRef(false);

    const getSnapshot = React.useCallback(() => {
      const currentState = state;
      if (!hasInitRef.current || currentState !== lastStateRef.current) {
        const nextResult = selector(currentState);
        if (hasInitRef.current && shallowEqual(nextResult, lastResultRef.current)) {
          lastStateRef.current = currentState;
        } else {
          lastStateRef.current = currentState;
          lastResultRef.current = nextResult;
          hasInitRef.current = true;
        }
      }
      return lastResultRef.current as SelectorOutput;
    }, [selector]);

    return useSyncExternalStore(
      subscribe,
      getSnapshot,
      getSnapshot
    );
  }

  return { getState, setState, setRawState, notifyListeners, subscribe, useStore };
}

export const unifiedAppStore = createStore<UnifiedAppContextProps>({} as UnifiedAppContextProps);

function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/**
 * 通过组合器维护的外部快照消费统一应用状态。
 * selector 输出使用浅比较缓存，避免无关业务状态变化引发全树重渲染。
 */
export function useUnifiedApp<SelectorOutput = UnifiedAppContextProps>(
  selector?: (state: UnifiedAppContextProps) => SelectorOutput
): SelectorOutput {
  const sel = selector || ((state: UnifiedAppContextProps) => state as unknown as SelectorOutput);
  return unifiedAppStore.useStore(sel);
}
