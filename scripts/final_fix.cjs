const fs = require('fs');

const goodNames = ["characters", "setCharacters", "sessions", "setSessions", "settings", "setSettings", "globalLorebook", "setGlobalLorebook", "activeCharId", "setActiveCharId", "activeSessionId", "setActiveSessionId", "showSessionManager", "setShowSessionManager", "showFullHistory", "setShowFullHistory", "activeTab", "setActiveTab", "chatSubTab", "setChatSubTab", "currentTheme", "setCurrentTheme", "handleThemeChange", "isSending", "setIsSending", "connectionStatus", "setConnectionStatus", "isDBReady", "setIsDBReady", "availableModels", "setAvailableModels", "isFetchingModels", "setIsFetchingModels", "handleFetchModels", "userInputMessage", "setUserInputMessage", "editingMsgId", "setEditingMsgId", "editingMsgContent", "setEditingMsgContent", "msgMenuId", "setMsgMenuId", "promptInputVal", "setPromptInputVal", "customDialog", "setCustomDialog", "showCustomAlert", "showCustomConfirm", "showCustomPrompt", "charModalOpen", "setCharModalOpen", "editingChar", "setEditingChar", "isDbWriting", "setIsDbWriting", "timelineModalOpen", "setTimelineModalOpen", "newSummaryTag", "setNewSummaryTag", "newSummaryLoc", "setNewSummaryLoc", "newSummaryContent", "setNewSummaryContent", "editingSummaryId", "setEditingSummaryId", "activeLoreTab", "setActiveLoreTab", "editingLoreEntry", "setEditingLoreEntry", "editingActiveCharLoreEntry", "setEditingActiveCharLoreEntry", "backupPass", "setBackupPass", "backupStatus", "setBackupStatus", "encryptBackup", "setEncryptBackup", "showBackupUI", "setShowBackupUI", "activeSettingAccordion", "setActiveSettingAccordion", "sillyInnerTab", "setSillyInnerTab", "expandedPromptIds", "setExpandedPromptIds", "togglePromptExpanded", "chatBottomRef", "activeCharacter", "activeSession", "updateSettings", "handleImportPresetJSON", "handleExportPresetJSON", "handleSaveNewPresetBundle", "handleLoadPresetBundle", "handleDeletePresetBundle", "handleToggleCustomPrompt", "handleUpdateCustomPrompt", "handleAddNewCustomPrompt", "handleDeleteCustomPrompt", "createNewBranch", "deleteBranch", "selectCharacter", "triggerScroll", "createNewSessionOfCharacter", "handleSendMessage", "handleRerollFromMessage", "handleRerollLast", "handleAutoSummaryCheck", "testApiConnection", "handleAddNewCharacter", "handleEditCharacter", "handleDeleteCharacter", "handleSaveCharacter", "handleImportCardFile", "handleImportSillyLorebook", "handleExportCharacterJSON", "handleExportCharacterPNG", "handleExportLocalDataBackup", "handleImportLocalDataBackup", "createBacktrackBranch", "createBacktrackFromTimeline", "handleAddTimelineSummary", "handleSaveLoreEntry", "handleSaveActiveCharLoreEntry", "editingGlobalEntry", "setEditingGlobalEntry", "handleSaveGlobalLoreEntry", "renderDialogueBubble"];

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

appContent = appContent.replace("  const appContextValue = { " + goodNames.join(', ') + " };\n", "");
appContent = appContent.replace("    <AppContext.Provider value={appContextValue}>\n", "");
appContent = appContent.replace("    </AppContext.Provider>\n  )\n}", "  )\n}");
appContent = appContent.replace("    </AppContext.Provider>\n  );", "  );");

const appReturnPos = appContent.indexOf('  return (\n    <div className={`flex overflow-hidden h-[100dvh]');
if (appReturnPos > -1) {
  const insertBeforeReturn = "  const appContextValue = { " + goodNames.join(', ') + " };\n";
  const insertAfterReturn = "    <AppContext.Provider value={appContextValue}>\n";
  
  appContent = appContent.substring(0, appReturnPos) + insertBeforeReturn + "  return (\n" + insertAfterReturn + appContent.substring(appReturnPos + 11);
  
  const appEndReturnPos = appContent.indexOf('  );\n}\n\n// Simple fallback info');
  if (appEndReturnPos > -1) {
      appContent = appContent.substring(0, appEndReturnPos) + "    </AppContext.Provider>\n" + appContent.substring(appEndReturnPos);
  }
}

fs.writeFileSync('src/App.tsx', appContent);
