import React from "react";
import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
  Message,
  SummaryCard,
  CustomPromptBlock,
} from "./types";
import {
  TabType,
  ThemeType,
  CustomDialogConfig,
} from "./contexts/AppContext";

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
  showCustomPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;

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

  // --- Settings Hook ---
  settings: UserSettings;
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  updateSettings: (newSet: UserSettings) => void;
  globalLorebook: LorebookEntry[];
  setGlobalLorebook: React.Dispatch<React.SetStateAction<LorebookEntry[]>>;
  updateGlobalLorebook: (entries: LorebookEntry[]) => Promise<void>;
  isReady: boolean;
  handleFetchModels: () => Promise<void>;
  testApiConnection: () => Promise<void>;
  handleImportPresetJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleExportPresetJSON: () => void;
  handleSaveNewPresetBundle: () => Promise<void>;
  handleLoadPresetBundle: (bundleId: string) => void;
  handleDeletePresetBundle: (presetId: string) => Promise<void>;
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
  handleSendMessage: (textToSend: string) => Promise<void>;
  handleStartNewSession: (customFirstMessage?: string) => Promise<void>;
  triggerScroll: (behavior?: "smooth" | "instant") => void;
  showSessionManager: boolean;
  setShowSessionManager: (show: boolean) => void;
  showFullHistory: boolean;
  setShowFullHistory: (show: boolean) => void;
  chatSubTab: "dialogue" | "timeline";
  setChatSubTab: (tab: "dialogue" | "timeline") => void;
  userInputMessage: string;
  setUserInputMessage: (msg: string) => void;
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
  newSummaryCondition: string;
  setNewSummaryCondition: (cond: string) => void;
  newSummaryInventory: string;
  setNewSummaryInventory: (inv: string) => void;
  newSummaryBonding: string;
  setNewSummaryBonding: (bond: string) => void;
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
  renderDialogueBubble: (text: string) => React.ReactNode;
  saveSessionWithMvu: (session: ChatSession, messageToParse?: string) => Promise<ChatSession>;
}

export const AppContext = React.createContext<UnifiedAppContextProps | null>(null);

