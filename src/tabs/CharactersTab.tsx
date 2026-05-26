import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { 
  ArrowLeft, Bot, User, Image as ImageIcon, Send, Settings, Plus, Trash2, Edit2, Copy, Save,
  FileUp, FileDown, Play, Check, Book, Brain, Clock, Sliders, Download, Upload, X,
  FileText, History, MessageSquare, KeySquare, HelpCircle, AlertCircle, RefreshCw, GitFork, UserCheck, Lock,
  ChevronDown, ChevronUp, Cpu
 } from "lucide-react";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message, SummaryCard, ApiConfig, SamplerPreset, MemoryConfig, PromptConfig } from "../types";
import { getAllCharacters, saveCharacter, deleteCharacter, getAllSessions, saveSession, deleteSession, getStoredSettings, saveStoredSettings, getGlobalLorebook, saveGlobalLorebook } from "../utils/localDB";
import { parseCharacterFile, injectPngMetadata, encryptBackupData, decryptBackupData } from "../utils/cardParser";
import { assemblePromptContext } from "../utils/promptBuilder";
import { DEFAULT_PRESETS, DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../App";

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../components/ui/accordion";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

export default function CharactersTab() {
  const { characters, setCharacters, sessions, setSessions, settings, setSettings, globalLorebook, setGlobalLorebook, activeCharId, setActiveCharId, activeSessionId, setActiveSessionId, showSessionManager, setShowSessionManager, showFullHistory, setShowFullHistory, activeTab, setActiveTab, chatSubTab, setChatSubTab, currentTheme, setCurrentTheme, handleThemeChange, isSending, setIsSending, connectionStatus, setConnectionStatus, isDBReady, setIsDBReady, availableModels, setAvailableModels, isFetchingModels, setIsFetchingModels, handleFetchModels, userInputMessage, setUserInputMessage, editingMsgId, setEditingMsgId, editingMsgContent, setEditingMsgContent, msgMenuId, setMsgMenuId, promptInputVal, setPromptInputVal, customDialog, setCustomDialog, showCustomAlert, showCustomConfirm, showCustomPrompt, charModalOpen, setCharModalOpen, editingChar, setEditingChar, isDbWriting, setIsDbWriting, timelineModalOpen, setTimelineModalOpen, newSummaryTag, setNewSummaryTag, newSummaryLoc, setNewSummaryLoc, newSummaryContent, setNewSummaryContent, activeLoreTab, setActiveLoreTab, editingLoreEntry, setEditingLoreEntry, editingActiveCharLoreEntry, setEditingActiveCharLoreEntry, backupPass, setBackupPass, backupStatus, setBackupStatus, encryptBackup, setEncryptBackup, showBackupUI, setShowBackupUI, activeSettingAccordion, setActiveSettingAccordion, sillyInnerTab, setSillyInnerTab, expandedPromptIds, setExpandedPromptIds, togglePromptExpanded, chatBottomRef, activeCharacter, activeSession, updateSettings, handleImportPresetJSON, handleExportPresetJSON, handleSaveNewPresetBundle, handleLoadPresetBundle, handleDeletePresetBundle, handleToggleCustomPrompt, handleUpdateCustomPrompt, handleAddNewCustomPrompt, handleDeleteCustomPrompt, createNewBranch, deleteBranch, selectCharacter, triggerScroll, createNewSessionOfCharacter, handleSendMessage, handleRerollFromMessage, handleRerollLast, handleAutoSummaryCheck, testApiConnection, handleAddNewCharacter, handleEditCharacter, handleDeleteCharacter, handleSaveCharacter, handleImportCardFile, handleImportSillyLorebook, handleExportCharacterJSON, handleExportCharacterPNG, handleExportLocalDataBackup, handleImportLocalDataBackup, createBacktrackBranch, createBacktrackFromTimeline, handleAddTimelineSummary, handleSaveLoreEntry, handleSaveActiveCharLoreEntry, editingGlobalEntry, setEditingGlobalEntry, handleSaveGlobalLoreEntry, renderDialogueBubble } = useContext(AppContext);
  return (
    
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3 pt-1">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5">
                  Mobile Tavern <span className="text-[11px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-mono">Lite</span>
                </h1>
                <p className="text-xs text-muted-foreground font-light mt-0.5">面向移动端的轻量角色扮演前端</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer bg-card active:scale-[0.98] text-muted-foreground p-2 rounded-lg border border-border transition flex items-center justify-center title='导入SillyTavern角色卡'">
                  <FileUp className="w-4 h-4" />
                  <input type="file" onChange={handleImportCardFile} accept=".png,.json" className="hidden" />
                </label>
                <button
                  onClick={handleAddNewCharacter}
                  className="bg-primary hover:bg-primary text-primary-foreground p-2 rounded-lg transition-all font-medium flex items-center justify-center"
                  title="手动创造新角色卡"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List Cards */}
            <div className="space-y-3">
              {characters.map((char) => {
                const charSessList = sessions.filter((s) => s.characterId === char.id);
                const isActive = activeCharId === char.id;

                return (
                  <div
                    key={char.id}
                    onClick={() => selectCharacter(char.id)}
                    className={`bg-card rounded-xl active:scale-[0.98] transition border p-3.5 relative cursor-pointer flex gap-3 h-32 select-none ${
                      isActive ? "border-primary/60 bg-muted/40" : "border-border"
                    }`}
                  >
                    {/* Character Avatar Grid */}
                    <div className="w-16 h-full rounded-lg bg-muted overflow-hidden flex-shrink-0 border border-border/50 flex items-center justify-center text-muted-foreground relative">
                      {char.avatar ? (
                        <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl font-serif text-primary font-bold">{char.name[0]}</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <h2 className="font-bold text-foreground text-sm truncate">{char.name}</h2>
                          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleEditCharacter(char)} className="text-muted-foreground hover:text-muted-foreground p-0.5">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={async () => {
                              const ok = await showCustomConfirm("确定导出JSON角色卡？");
                              if (ok) handleExportCharacterJSON(char);
                            }} className="text-muted-foreground hover:text-muted-foreground p-0.5" title="导出JSON">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleExportCharacterPNG(char)} className="text-muted-foreground hover:text-muted-foreground p-0.5" title="导出SillyTavern PNG">
                              <ImageIcon className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => handleDeleteCharacter(char.id, e)} className="text-red-500/70 hover:text-red-400 p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed font-light">{char.description || char.personality || "暂无信息说明..."}</p>
                      </div>

                      {/* Active Sub-timeline select if multiple branches exist */}
                      <div className="flex items-center gap-1.5 opacity-80 pt-1 pointer-events-none">
                        <span className="text-[10px] bg-muted text-muted-foreground px-1 py-0.5 rounded flex items-center gap-1 leading-none">
                          <RefreshCw className="w-2.5 h-2.5" /> {charSessList.length} 个故事分支
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {characters.length === 0 && (
                <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl flex flex-col items-center justify-center">
                  <Bot className="w-10 h-10 stroke-[1.2] mb-2 text-muted-foreground" />
                  <p className="text-sm">本地数据库空空如也</p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-xs leading-relaxed">上传现有的 SillyTavern 兼容 PNG 写实角色卡或点击右上角按钮手工创造一个新世界。</p>
                </div>
              )}
            </div>
          </div>
        
  );
}
