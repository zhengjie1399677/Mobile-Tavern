const fs = require('fs');

const goodNames = ["characters", "setCharacters", "sessions", "setSessions", "settings", "setSettings", "globalLorebook", "setGlobalLorebook", "activeCharId", "setActiveCharId", "activeSessionId", "setActiveSessionId", "showSessionManager", "setShowSessionManager", "showFullHistory", "setShowFullHistory", "activeTab", "setActiveTab", "chatSubTab", "setChatSubTab", "currentTheme", "setCurrentTheme", "handleThemeChange", "isSending", "setIsSending", "connectionStatus", "setConnectionStatus", "isDBReady", "setIsDBReady", "availableModels", "setAvailableModels", "isFetchingModels", "setIsFetchingModels", "handleFetchModels", "userInputMessage", "setUserInputMessage", "editingMsgId", "setEditingMsgId", "editingMsgContent", "setEditingMsgContent", "msgMenuId", "setMsgMenuId", "promptInputVal", "setPromptInputVal", "customDialog", "setCustomDialog", "showCustomAlert", "showCustomConfirm", "showCustomPrompt", "charModalOpen", "setCharModalOpen", "editingChar", "setEditingChar", "isDbWriting", "setIsDbWriting", "timelineModalOpen", "setTimelineModalOpen", "newSummaryTag", "setNewSummaryTag", "newSummaryLoc", "setNewSummaryLoc", "newSummaryContent", "setNewSummaryContent", "activeLoreTab", "setActiveLoreTab", "editingLoreEntry", "setEditingLoreEntry", "editingActiveCharLoreEntry", "setEditingActiveCharLoreEntry", "backupPass", "setBackupPass", "backupStatus", "setBackupStatus", "encryptBackup", "setEncryptBackup", "showBackupUI", "setShowBackupUI", "activeSettingAccordion", "setActiveSettingAccordion", "sillyInnerTab", "setSillyInnerTab", "expandedPromptIds", "setExpandedPromptIds", "togglePromptExpanded", "chatBottomRef", "activeCharacter", "activeSession", "updateSettings", "handleImportPresetJSON", "handleExportPresetJSON", "handleSaveNewPresetBundle", "handleLoadPresetBundle", "handleDeletePresetBundle", "handleToggleCustomPrompt", "handleUpdateCustomPrompt", "handleAddNewCustomPrompt", "handleDeleteCustomPrompt", "createNewBranch", "deleteBranch", "selectCharacter", "triggerScroll", "createNewSessionOfCharacter", "handleSendMessage", "handleRerollFromMessage", "handleRerollLast", "handleAutoSummaryCheck", "testApiConnection", "handleAddNewCharacter", "handleEditCharacter", "handleDeleteCharacter", "handleSaveCharacter", "handleImportCardFile", "handleImportSillyLorebook", "handleExportCharacterJSON", "handleExportCharacterPNG", "handleExportLocalDataBackup", "handleImportLocalDataBackup", "createBacktrackBranch", "createBacktrackFromTimeline", "handleAddTimelineSummary", "handleSaveLoreEntry", "handleSaveActiveCharLoreEntry", "editingGlobalEntry", "setEditingGlobalEntry", "handleSaveGlobalLoreEntry", "renderDialogueBubble"];

// 1. App.tsx
let appContent = fs.readFileSync('src/App.tsx', 'utf8');
const appContextLineMatch = appContent.match(/  const appContextValue = \{ [^}]* \};\n/);
if (appContextLineMatch) {
  appContent = appContent.replace(appContextLineMatch[0], "  const appContextValue = { " + goodNames.join(', ') + " };\n");
  fs.writeFileSync('src/App.tsx', appContent);
}

// 2. Tabs
const tabs = ['CharactersTab', 'ChatHistoryTab', 'ChatTab', 'GlobalWorldbookTab', 'SettingsTab'];
tabs.forEach(tab => {
  let content = fs.readFileSync("src/tabs/" + tab + ".tsx", 'utf8');
  content = content.replace(/const \{ [^}]* \} = useContext\(AppContext\);/, "const { " + goodNames.join(', ') + " } = useContext(AppContext);");
  fs.writeFileSync("src/tabs/" + tab + ".tsx", content);
});

console.log('Fixed context variables');
