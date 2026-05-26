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

export default function ChatHistoryTab() {
  const { characters, setCharacters, sessions, setSessions, settings, setSettings, globalLorebook, setGlobalLorebook, activeCharId, setActiveCharId, activeSessionId, setActiveSessionId, showSessionManager, setShowSessionManager, showFullHistory, setShowFullHistory, activeTab, setActiveTab, chatSubTab, setChatSubTab, currentTheme, setCurrentTheme, handleThemeChange, isSending, setIsSending, connectionStatus, setConnectionStatus, isDBReady, setIsDBReady, availableModels, setAvailableModels, isFetchingModels, setIsFetchingModels, handleFetchModels, userInputMessage, setUserInputMessage, editingMsgId, setEditingMsgId, editingMsgContent, setEditingMsgContent, msgMenuId, setMsgMenuId, promptInputVal, setPromptInputVal, customDialog, setCustomDialog, showCustomAlert, showCustomConfirm, showCustomPrompt, charModalOpen, setCharModalOpen, editingChar, setEditingChar, isDbWriting, setIsDbWriting, timelineModalOpen, setTimelineModalOpen, newSummaryTag, setNewSummaryTag, newSummaryLoc, setNewSummaryLoc, newSummaryContent, setNewSummaryContent, activeLoreTab, setActiveLoreTab, editingLoreEntry, setEditingLoreEntry, editingActiveCharLoreEntry, setEditingActiveCharLoreEntry, backupPass, setBackupPass, backupStatus, setBackupStatus, encryptBackup, setEncryptBackup, showBackupUI, setShowBackupUI, activeSettingAccordion, setActiveSettingAccordion, sillyInnerTab, setSillyInnerTab, expandedPromptIds, setExpandedPromptIds, togglePromptExpanded, chatBottomRef, activeCharacter, activeSession, updateSettings, handleImportPresetJSON, handleExportPresetJSON, handleSaveNewPresetBundle, handleLoadPresetBundle, handleDeletePresetBundle, handleToggleCustomPrompt, handleUpdateCustomPrompt, handleAddNewCustomPrompt, handleDeleteCustomPrompt, createNewBranch, deleteBranch, selectCharacter, triggerScroll, createNewSessionOfCharacter, handleSendMessage, handleRerollFromMessage, handleRerollLast, handleAutoSummaryCheck, testApiConnection, handleAddNewCharacter, handleEditCharacter, handleDeleteCharacter, handleSaveCharacter, handleImportCardFile, handleImportSillyLorebook, handleExportCharacterJSON, handleExportCharacterPNG, handleExportLocalDataBackup, handleImportLocalDataBackup, createBacktrackBranch, createBacktrackFromTimeline, handleAddTimelineSummary, handleSaveLoreEntry, handleSaveActiveCharLoreEntry, editingGlobalEntry, setEditingGlobalEntry, handleSaveGlobalLoreEntry, renderDialogueBubble } = useContext(AppContext);
  return (
    
          <div className="p-4 space-y-4 pb-20">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5 pb-2 border-b border-border">
              历史对话 (History)
            </h1>
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
                <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-sm">暂无任何对话记录</p>
                <p className="text-[11px] mt-1">去角色馆选择一个角色开始聊天吧！</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {[...sessions].sort((a,b) => b.createdAt - a.createdAt).map(s => {
                  const char = characters.find(c => c.id === s.characterId);
                  return (
                    <div 
                      key={s.id} 
                      className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition shadow-sm"
                      onClick={() => {
                        setActiveCharId(s.characterId);
                        setActiveSessionId(s.id);
                        setActiveTab("chat");
                        setChatSubTab("dialogue");
                        triggerScroll();
                      }}
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-muted border border-border/80 shrink-0">
                        {char?.avatar ? <img src={char.avatar} alt="avatar" className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-sm font-bold text-primary">{char?.name?.[0] || "?"}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm truncate text-foreground">{s.title || "主剧情线"}</h4>
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap pt-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate opacity-70">
                          {char?.name || "未知角色"} | {s.messages.length} 回合 | {s.messages.reduce((total, msg) => total + msg.content.length, 0) > 1000 ? (s.messages.reduce((total, msg) => total + msg.content.length, 0) / 1000).toFixed(1) + "k" : s.messages.reduce((total, msg) => total + msg.content.length, 0)} 字
                        </p>
                      </div>
                      <button 
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive p-2 rounded shrink-0 transition"
                        title="删除对话"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBranch(s.id);
                        }}
                      >
                         <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        
  );
}
