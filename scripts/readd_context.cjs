const fs = require('fs');

const goodNames = ["characters", "setCharacters", "sessions", "setSessions", "settings", "setSettings", "globalLorebook", "setGlobalLorebook", "activeCharId", "setActiveCharId", "activeSessionId", "setActiveSessionId", "showSessionManager", "setShowSessionManager", "showFullHistory", "setShowFullHistory", "activeTab", "setActiveTab", "chatSubTab", "setChatSubTab", "currentTheme", "setCurrentTheme", "handleThemeChange", "isSending", "setIsSending", "connectionStatus", "setConnectionStatus", "isDBReady", "setIsDBReady", "availableModels", "setAvailableModels", "isFetchingModels", "setIsFetchingModels", "handleFetchModels", "userInputMessage", "setUserInputMessage", "editingMsgId", "setEditingMsgId", "editingMsgContent", "setEditingMsgContent", "msgMenuId", "setMsgMenuId", "promptInputVal", "setPromptInputVal", "customDialog", "setCustomDialog", "showCustomAlert", "showCustomConfirm", "showCustomPrompt", "charModalOpen", "setCharModalOpen", "editingChar", "setEditingChar", "isDbWriting", "setIsDbWriting", "timelineModalOpen", "setTimelineModalOpen", "newSummaryTag", "setNewSummaryTag", "newSummaryLoc", "setNewSummaryLoc", "newSummaryContent", "setNewSummaryContent", "editingSummaryId", "setEditingSummaryId", "activeLoreTab", "setActiveLoreTab", "editingLoreEntry", "setEditingLoreEntry", "editingActiveCharLoreEntry", "setEditingActiveCharLoreEntry", "backupPass", "setBackupPass", "backupStatus", "setBackupStatus", "encryptBackup", "setEncryptBackup", "showBackupUI", "setShowBackupUI", "activeSettingAccordion", "setActiveSettingAccordion", "sillyInnerTab", "setSillyInnerTab", "expandedPromptIds", "setExpandedPromptIds", "togglePromptExpanded", "chatBottomRef", "activeCharacter", "activeSession", "updateSettings", "handleImportPresetJSON", "handleExportPresetJSON", "handleSaveNewPresetBundle", "handleLoadPresetBundle", "handleDeletePresetBundle", "handleToggleCustomPrompt", "handleUpdateCustomPrompt", "handleAddNewCustomPrompt", "handleDeleteCustomPrompt", "createNewBranch", "deleteBranch", "selectCharacter", "triggerScroll", "createNewSessionOfCharacter", "handleSendMessage", "handleRerollFromMessage", "handleRerollLast", "handleAutoSummaryCheck", "testApiConnection", "handleAddNewCharacter", "handleEditCharacter", "handleDeleteCharacter", "handleSaveCharacter", "handleImportCardFile", "handleImportSillyLorebook", "handleExportCharacterJSON", "handleExportCharacterPNG", "handleExportLocalDataBackup", "handleImportLocalDataBackup", "createBacktrackBranch", "createBacktrackFromTimeline", "handleAddTimelineSummary", "handleSaveLoreEntry", "handleSaveActiveCharLoreEntry", "editingGlobalEntry", "setEditingGlobalEntry", "handleSaveGlobalLoreEntry", "renderDialogueBubble"];

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

const targetReturn = "  return (\n    <div className=\"flex flex-col h-screen max-w-lg mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans\">";

const insertStr = "  const appContextValue = {" + goodNames.join(', ') + "};\n  return (\n    <AppContext.Provider value={appContextValue}>\n      <div className=\"flex flex-col h-screen max-w-lg mx-auto bg-background border-x border-border text-foreground shadow-xl relative overflow-hidden font-sans\">";

appContent = appContent.replace(targetReturn, insertStr);

const endTarget = "    </div>\n  );\n}\n\n// Simple fallback info / icon selectors";

const endReplace = "    </div>\n    </AppContext.Provider>\n  );\n}\n\n// Simple fallback info / icon selectors";

appContent = appContent.replace(endTarget, endReplace);

fs.writeFileSync('src/App.tsx', appContent);
