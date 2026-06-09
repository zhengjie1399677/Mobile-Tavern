import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import {
  ArrowLeft,
  Send,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  Brain,
  Clock,
  X,
  History,
  MessageSquare,
  AlertCircle,
  RefreshCw,
  GitFork,
  ChevronUp,
  Cpu,
  SlidersHorizontal,
} from "lucide-react";

import { saveSession } from "../utils/localDB";
import { initTavernHelperBridge, cleanTavernHelperBridge, createScriptIframeSrcDoc } from "../utils/tavernHelperBridge";
import CharacterDetailDrawer from "../components/CharacterDetailDrawer";

const isSafeRegex = (pattern: string): boolean => {
  if (!pattern) return true;
  return !/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(pattern) && !/(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(pattern);
};

const ChatInputArea = () => {
  const {
    isSending,
    setIsSending,
    activeSession,
    settings,
    activeCharacter,
    handleRerollLast,
    showCustomConfirm,
    handleAutoSummaryCheck,
    handleSendMessage,
  } = React.useContext(AppContext);
  const [localInput, setLocalInput] = React.useState("");

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [localInput]);

  const onSend = () => {
    if (!localInput.trim()) return;
    const msg = localInput;
    setLocalInput("");
    handleSendMessage(msg);
  };

  return (
    <div className="bg-card pt-3 px-3 pb-[max(var(--safe-area-bottom),12px)] border-t border-border flex flex-col gap-2 z-10 shrink-0">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRerollLast()}
            disabled={
              isSending ||
              !activeSession ||
              !activeSession.messages.some((m: any) => m.sender === "assistant")
            }
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary disabled:opacity-40 transition-colors"
            title="消除整条故事分支的最后一条AI回复并进行重新生成"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSending ? "animate-spin" : ""}`}
            />
            <span className="text-[10px] font-medium">重载上一段剧情</span>
          </button>
          <button
            onClick={async () => {
              if (!activeSession) return;
              const ok = await showCustomConfirm(
                "是否启动智能AI卡片压缩？这会将更早的历史对话转化为单条时间轴年表，腾出内存空间，保持语调连贯。",
              );
              if (ok) {
                setIsSending(true);
                await handleAutoSummaryCheck(activeSession, true);
                setIsSending(false);
              }
            }}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
            title="呼叫智能记忆压缩年表"
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">整理潜意识碎片</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[9px] opacity-70">
          <Cpu className="w-3 h-3" />
          <span>
            发包预测: ~
            {Math.ceil(
              (localInput || "").length * 1.5 +
                (activeSession?.messages
                  .slice(-settings.memory.recentTurns)
                  .reduce(
                    (acc: any, m: any) => acc + (m.content || "").length,
                    0,
                  ) || 0) *
                  1.5 +
                ((activeCharacter?.description || "").length +
                  (activeCharacter?.personality || "").length +
                  (activeCharacter?.scenario || "").length +
                  (activeCharacter?.system_prompt || "").length) *
                  1.5 +
                (settings.promptConfig?.customPrompts || [])
                  .filter((p: any) => p.enabled)
                  .reduce(
                    (acc: any, p: any) => acc + (p.content || "").length,
                    0,
                  ) *
                  1.5 +
                (activeSession?.summaries || []).reduce(
                  (acc: any, s: any) => acc + (s.content || "").length,
                  0,
                ) *
                  1.5,
            )}{" "}
            tok
          </span>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={`发送一条对白至 ${activeCharacter?.name} 启程...`}
          rows={2}
          className="flex-1 bg-muted border border-border rounded-lg py-2.5 px-3 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none font-light overflow-y-auto max-h-[180px] min-h-[48px]"
        />
        <button
          onClick={onSend}
          disabled={isSending || !localInput.trim()}
          className="p-3.5 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground transition-all shadow-md flex items-center justify-center shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-1.5 p-2 px-1">
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "0ms" }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "200ms" }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]"
        style={{ animationDelay: "400ms" }}
      />
    </div>
  );
};

export default function ChatTab() {
  const {
    sessions,
    setSessions,
    settings,
    activeSessionId,
    setShowSessionManager,
    showFullHistory,
    setShowFullHistory,
    setActiveTab,
    chatSubTab,
    setChatSubTab,
    isSending,
    setIsSending,
    isSummarizing,
    editingMsgId,
    setEditingMsgId,
    editingMsgContent,
    setEditingMsgContent,
    msgMenuId,
    setMsgMenuId,
    showCustomConfirm,
    showCustomPrompt,
    setTimelineModalOpen,
    setNewSummaryTag,
    setNewSummaryLoc,
    setNewSummaryContent,
    setNewSummaryCondition,
    setNewSummaryInventory,
    setNewSummaryBonding,
    setEditingSummaryId,
    chatBottomRef,
    activeCharacter,
    activeSession,
    handleSendMessage,
    handleRerollFromMessage,
    handleRerollLast,
    handleAutoSummaryCheck,
    createBacktrackBranch,
    createBacktrackFromTimeline,
    renderDialogueBubble,
    setCharacters,
    saveCharacter,
    updateSettings,
  } = useContext(AppContext);

  // Keep the bridge params in sync with latest React state on every relevant change.
  // We do NOT call cleanTavernHelperBridge() inside the cleanup because that would
  // destroy the bridge (and all iframe event listeners) on every activeSession update.
  // The bridge is only torn down when the ChatTab itself unmounts.
  React.useEffect(() => {
    if (settings.enableScriptExecution) {
      initTavernHelperBridge({
        activeCharacter,
        activeSession,
        setSessions,
        saveSession,
        setCharacters,
        saveCharacter,
        settings,
        updateSettings,
        handleSendMessage,
      });
    } else {
      cleanTavernHelperBridge();
    }
  }, [
    activeCharacter,
    activeSession,
    setSessions,
    setCharacters,
    settings,
    updateSettings,
    handleSendMessage,
  ]);

  // Only clean up the bridge when the ChatTab unmounts entirely.
  React.useEffect(() => {
    return () => {
      cleanTavernHelperBridge();
    };
  }, []);

  const [isPortraitCollapsed, setIsPortraitCollapsed] = React.useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = React.useState(false);
  const [visibleExtensions, setVisibleExtensions] = React.useState<string[]>(["condition", "inventory", "bonding"]);
  const [showExtDropdown, setShowExtDropdown] = React.useState(false);

  const hasExpressions = React.useMemo(() => {
    if (!activeCharacter) return false;
    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions;
    if (!expressions) return false;
    if (Array.isArray(expressions) && expressions.length > 0) return true;
    if (typeof expressions === "object" && Object.keys(expressions).length > 0) return true;
    return false;
  }, [activeCharacter]);

  const activePortraitUrl = React.useMemo(() => {
    if (!activeCharacter) return "";
    
    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};

    if (!expressions || (Array.isArray(expressions) && expressions.length === 0) || (typeof expressions === "object" && Object.keys(expressions).length === 0)) {
      return activeCharacter.avatar || "";
    }

    let lastAiText = "";
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        lastAiText = messages[i].content.toLowerCase();
        break;
      }
    }

    if (Array.isArray(expressions)) {
      for (const rule of expressions) {
        if (rule && typeof rule === "object" && rule.name && rule.image) {
          if (rule.triggers && lastAiText) {
            try {
              if (isSafeRegex(rule.triggers)) {
                const regex = new RegExp(rule.triggers, "i");
                if (regex.test(lastAiText)) {
                  return rule.image;
                }
              } else {
                console.warn("Potential ReDoS pattern bypassed in triggers matching:", rule.triggers);
                if (lastAiText.includes(rule.triggers.toLowerCase())) {
                  return rule.image;
                }
              }
            } catch (err) {
              console.warn("Invalid triggers RegExp in card:", rule.triggers, err);
            }
          }
        }
      }
      const defaultRule = expressions.find(r => r && (r.name === "default" || r.name === "neutral"));
      if (defaultRule && defaultRule.image) {
        return defaultRule.image;
      }
      return expressions[0]?.image || activeCharacter.avatar || "";
    }

    if (typeof expressions === "object") {
      const presetTriggers: Record<string, string> = settings.expressionTriggers || {
        joy: "笑了|微笑|开心|😊|smile|joy|happy",
        happy: "笑了|微笑|开心|😊|smile|joy|happy",
        smile: "笑了|微笑|开心|😊|smile|joy|happy",
        sadness: "哭|流泪|伤心|😢|cry|sad",
        sad: "哭|流泪|伤心|😢|cry|sad",
        cry: "哭|流泪|伤心|😢|cry|sad",
        anger: "生气|愤怒|😡|angry|rage",
        angry: "生气|愤怒|😡|angry|rage",
        rage: "生气|愤怒|😡|angry|rage",
        blush: "脸红|害羞|😳|blush|shy",
        shy: "脸红|害羞|😳|blush|shy",
      };

      if (lastAiText) {
        for (const key of Object.keys(expressions)) {
          const lowerKey = key.toLowerCase();
          const triggerPattern = presetTriggers[lowerKey];
          if (triggerPattern) {
            try {
              if (isSafeRegex(triggerPattern)) {
                const regex = new RegExp(triggerPattern, "i");
                if (regex.test(lastAiText)) {
                  return expressions[key];
                }
              } else {
                if (lastAiText.includes(triggerPattern.toLowerCase())) {
                  return expressions[key];
                }
              }
            } catch (err) {}
          }
        }
      }
      return expressions["default"] || expressions["neutral"] || expressions["normal"] || Object.values(expressions)[0] || activeCharacter.avatar || "";
    }

    return activeCharacter.avatar || "";
  }, [activeCharacter, activeSession, settings]);

  const currentEmotionName = React.useMemo(() => {
    if (!activeCharacter) return "默认";
    
    const ext = activeCharacter.extensions || {};
    const rawStyle = ext.style || ext.character_style || {};
    const expressions = activeCharacter.visualSettings?.expressions || rawStyle.expressions || ext.expressions || {};

    if (!expressions || (Array.isArray(expressions) && expressions.length === 0) || (typeof expressions === "object" && Object.keys(expressions).length === 0)) {
      return "默认";
    }

    let lastAiText = "";
    const messages = activeSession?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "assistant" && messages[i].content) {
        lastAiText = messages[i].content.toLowerCase();
        break;
      }
    }

    if (!lastAiText) return "默认";

    if (Array.isArray(expressions)) {
      for (const rule of expressions) {
        if (rule && rule.name && rule.triggers && lastAiText) {
          try {
            if (isSafeRegex(rule.triggers)) {
              const regex = new RegExp(rule.triggers, "i");
              if (regex.test(lastAiText)) {
                return rule.name;
              }
            } else {
              if (lastAiText.includes(rule.triggers.toLowerCase())) {
                return rule.name;
              }
            }
          } catch (err) {}
        }
      }
      return "默认";
    }

    if (typeof expressions === "object") {
      const presetTriggers: Record<string, string> = settings.expressionTriggers || {
        joy: "笑了|微笑|开心|😊|smile|joy|happy",
        happy: "笑了|微笑|开心|😊|smile|joy|happy",
        smile: "笑了|微笑|开心|😊|smile|joy|happy",
        sadness: "哭|流泪|伤心|😢|cry|sad",
        sad: "哭|流泪|伤心|😢|cry|sad",
        cry: "哭|流泪|伤心|😢|cry|sad",
        anger: "生气|愤怒|😡|angry|rage",
        angry: "生气|愤怒|😡|angry|rage",
        rage: "生气|愤怒|😡|angry|rage",
        blush: "脸红|害羞|😳|blush|shy",
        shy: "脸红|害羞|😳|blush|shy",
      };

      for (const key of Object.keys(expressions)) {
        const lowerKey = key.toLowerCase();
        const triggerPattern = presetTriggers[lowerKey];
        if (triggerPattern) {
          try {
            if (isSafeRegex(triggerPattern)) {
              const regex = new RegExp(triggerPattern, "i");
              if (regex.test(lastAiText)) {
                return key;
              }
            } else {
              if (lastAiText.includes(triggerPattern.toLowerCase())) {
                return key;
              }
            }
          } catch (err) {}
        }
      }
    }

    return "默认";
  }, [activeCharacter, activeSession, settings]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {activeCharacter?.visualSettings?.customCss && (
        <style dangerouslySetInnerHTML={{ __html: activeCharacter.visualSettings.customCss }} />
      )}
      {/* Embedded Header info card */}
      <div className="bg-card p-3 border-b border-border flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setActiveTab("characters")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div
            onClick={() => setIsDetailDrawerOpen(true)}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer hover:opacity-85 active:scale-98 transition-all"
            title="查看角色卡详情"
          >
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted border border-border/80 flex items-center justify-center flex-shrink-0">
              {activeCharacter?.avatar ? (
                <img
                  src={activeCharacter.avatar}
                  alt={activeCharacter.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-base font-serif font-bold text-primary">
                  {activeCharacter?.name?.[0]}
                </span>
              )}
            </div>
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-foreground truncate leading-tight">
                  {activeCharacter?.name}
                </h2>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSessionManager(true);
                  }}
                  className="text-primary hover:bg-primary/10 p-0.5 rounded transition"
                  title="分支管理"
                >
                  <GitFork className="w-3 h-3" />
                </button>
              </div>
              <p
                className="text-[10px] text-muted-foreground truncate mt-0.5 font-light cursor-pointer"
                onClick={async (e) => {
                  e.stopPropagation();
                  const nextTitle = await showCustomPrompt(
                    "修改当前分支线标题已在IndexedDB进行分支区分:",
                    activeSession?.title || "",
                  );
                  if (nextTitle && activeSession) {
                    const updated = { ...activeSession, title: nextTitle };
                    setSessions((prev) =>
                      prev.map((s) => (s.id === updated.id ? updated : s)),
                    );
                    await saveSession(updated);
                  }
                }}
              >
                {activeSession?.title || "主剧情线"} (点击修改)
              </p>
            </div>
          </div>
        </div>

        {/* Chat sub tabs switches and settings dropdown */}
        <div className="flex items-center gap-1.5 relative">
          <div className="flex bg-muted p-0.5 rounded-lg border border-border">
            <button
              onClick={() => setChatSubTab("dialogue")}
              className={`px-2.5 py-1 text-[11px] rounded transition font-medium flex items-center gap-1 ${
                chatSubTab === "dialogue"
                  ? "bg-primary/40 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> 剧本对白
            </button>
            <button
              onClick={() => setChatSubTab("timeline")}
              className={`px-2.5 py-1 text-[11px] rounded transition font-medium flex items-center gap-1 ${
                chatSubTab === "timeline"
                  ? "bg-primary/40 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="w-3.5 h-3.5" /> 故事年表 (
              {activeSession?.summaries?.length || 0})
            </button>
          </div>

          {chatSubTab === "timeline" && (
            <div className="relative">
              <button
                onClick={() => setShowExtDropdown(!showExtDropdown)}
                className={`p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition ${
                  showExtDropdown ? "bg-muted text-foreground" : "bg-card"
                }`}
                title="扩展字段过滤"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              
              {showExtDropdown && (
                <div className="absolute right-0 top-full mt-1.5 bg-popover border border-border rounded-lg p-2 flex flex-col gap-2 min-w-[90px] shadow-xl z-20 animate-fadeIn text-[10px]">
                  <span className="text-[9px] text-muted-foreground font-bold tracking-wider uppercase px-1 border-b border-border pb-1 mb-0.5">
                    显示选项
                  </span>
                  <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                    <input
                      type="checkbox"
                      checked={visibleExtensions.includes("condition")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleExtensions([...visibleExtensions, "condition"]);
                        } else {
                          setVisibleExtensions(visibleExtensions.filter(x => x !== "condition"));
                        }
                      }}
                      className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                    />
                    💓 心境
                  </label>
                  <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                    <input
                      type="checkbox"
                      checked={visibleExtensions.includes("inventory")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleExtensions([...visibleExtensions, "inventory"]);
                        } else {
                          setVisibleExtensions(visibleExtensions.filter(x => x !== "inventory"));
                        }
                      }}
                      className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                    />
                    🎒 道具
                  </label>
                  <label className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-foreground cursor-pointer hover:bg-muted rounded transition">
                    <input
                      type="checkbox"
                      checked={visibleExtensions.includes("bonding")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setVisibleExtensions([...visibleExtensions, "bonding"]);
                        } else {
                          setVisibleExtensions(visibleExtensions.filter(x => x !== "bonding"));
                        }
                      }}
                      className="rounded border-border bg-input text-primary focus:ring-0 focus:ring-offset-0 w-3 h-3"
                    />
                    🔗 羁绊
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2.5. Character Big Portrait Section (Dynamic Expressions) */}
      {activeCharacter && hasExpressions && activePortraitUrl && (
        <div className="bg-card border-b border-border transition-all duration-300 overflow-hidden flex flex-col items-center relative shrink-0">
          {!isPortraitCollapsed ? (
            <div className="w-full flex flex-col items-center justify-center p-3 relative h-48 animate-fadeIn">
              {/* Glassmorphic background disc */}
              <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-60 pointer-events-none" />
              <div className="w-40 h-40 rounded-2xl overflow-hidden border border-border bg-muted/30 shadow-lg relative flex items-center justify-center">
                {/* Render the active portrait with a smooth transition */}
                <img
                  key={activePortraitUrl}
                  src={activePortraitUrl}
                  alt={`${activeCharacter.name} Portrait`}
                  className="w-full h-full object-cover animate-fadeIn"
                />
                
                {/* Emotion Badge indicator */}
                <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm border border-border text-[9px] font-bold px-1.5 py-0.5 rounded-md shadow-sm">
                  {currentEmotionName}
                </div>
              </div>
              
              {/* Fold button */}
              <button
                onClick={() => setIsPortraitCollapsed(true)}
                className="absolute top-2 right-3 text-muted-foreground hover:text-foreground p-1 transition"
                title="收起立绘"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div 
              className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground bg-muted/30 hover:bg-muted/50 transition cursor-pointer" 
              onClick={() => setIsPortraitCollapsed(false)}
            >
              <span className="font-medium flex items-center gap-1.5">
                🖼️ 点击展开角色动态情绪立绘
              </span>
              <span className="scale-90 opacity-70">展开立绘 ⬇️</span>
            </div>
          )}
        </div>
      )}

      {/* Sub-tab 1: DIALOGUE HISTORY */}
      {chatSubTab === "dialogue" && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Custom card background layer */}
          {activeCharacter?.visualSettings?.backgroundImageUrl && (
            <div
              className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center transition-all duration-700"
              style={{
                backgroundImage: `url(${activeCharacter.visualSettings.backgroundImageUrl})`,
                opacity: activeCharacter.visualSettings.backgroundOpacity ?? 0.15,
                filter: `blur(${activeCharacter.visualSettings.backgroundBlur ?? 4}px)`,
              }}
            />
          )}


          {/* Dialog Scroll area */}
          <div
            className="p-3.5 space-y-4 flex-1 overflow-y-auto custom-scrollbar relative z-10"
            onClick={() => {
              if (msgMenuId) setMsgMenuId(null);
            }}
          >
            {(() => {
              let messagesToRender = activeSession?.messages || [];
              let foldedCount = 0;
              if (!showFullHistory && messagesToRender.length > 20) {
                let foldIndex = messagesToRender.length - 20;
                foldedCount = foldIndex;
                messagesToRender = messagesToRender.slice(foldIndex);
              }

              // Precalculate round index for each message in activeSession.messages
              const roundNums: Record<string, number> = {};
              let roundCount = 0;
              (activeSession?.messages || []).forEach((m) => {
                if (m.sender === "user") {
                  roundCount++;
                }
                roundNums[m.id] = roundCount;
              });

              return (
                <>
                  {foldedCount > 0 && (
                    <div className="flex justify-center mb-2 animate-fadeIn">
                      <button
                        onClick={() => setShowFullHistory(true)}
                        className="bg-muted hover:bg-muted/80 border border-border text-[10px] px-4 py-1.5 rounded-full text-muted-foreground shadow-sm flex items-center gap-1.5 transition"
                      >
                        <ChevronUp className="w-3 h-3" /> 点击展开更早的{" "}
                        {foldedCount} 条历史对话 (节约内存渲染)
                      </button>
                    </div>
                  )}
                  {messagesToRender.map((message) => {
                    const isUser = message.sender === "user";
                    const isSystem = message.sender === "system";

                    if (isSystem) {
                      return (
                        <div
                          key={message.id}
                          className="flex items-center justify-center"
                        >
                          <div className="bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-lg border border-primary/30 max-w-xs text-center flex items-start gap-1.5 leading-relaxed">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>{message.content}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={message.id}
                        className={`flex items-start gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                      >
                        {/* Circle Avatar fallback */}
                        <div
                          className={`w-8 h-8 rounded-[11px] bg-gradient-to-br flex items-center justify-center font-bold text-xs shadow-sm border flex-shrink-0 overflow-hidden ${
                            isUser
                              ? "from-secondary to-muted border-border text-foreground"
                              : "from-card to-muted border-border text-foreground font-serif"
                          }`}
                        >
                          {isUser ? (
                            "我"
                          ) : !isSystem && activeCharacter?.avatar ? (
                            <img
                              src={activeCharacter.avatar}
                              alt={activeCharacter.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            activeCharacter?.name?.[0] || "AI"
                          )}
                        </div>

                        {/* Speech Bubble */}
                        <div
                          className="max-w-[78%] group relative"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (editingMsgId !== message.id) {
                              setMsgMenuId(
                                msgMenuId === message.id ? null : message.id,
                              );
                            }
                          }}
                        >
                          {editingMsgId === message.id ? (
                            <div
                              className={`rounded-xl p-3 shadow-sm text-sm border transition-all ${
                                isUser
                                  ? "bg-primary/10 border-primary/50"
                                  : "bg-input border-border"
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <textarea
                                value={editingMsgContent}
                                onChange={(e) =>
                                  setEditingMsgContent(e.target.value)
                                }
                                className="w-full text-sm bg-muted border border-border rounded-lg p-2.5 text-foreground outline-none leading-relaxed resize-y font-light mb-2 focus:border-primary/50"
                                rows={Math.max(
                                  3,
                                  editingMsgContent.split("\n").length,
                                )}
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!activeSession) return;
                                    const nextMsgs = activeSession.messages.map(
                                      (m) =>
                                        m.id === message.id
                                          ? { ...m, content: editingMsgContent }
                                          : m,
                                    );
                                    const updated = {
                                      ...activeSession,
                                      messages: nextMsgs,
                                    };
                                    setSessions((prev) =>
                                      prev.map((s) =>
                                        s.id === updated.id ? updated : s,
                                      ),
                                    );
                                    await saveSession(updated);
                                    setEditingMsgId(null);
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 shadow"
                                >
                                  <Check className="w-3.5 h-3.5" /> 保存
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingMsgId(null);
                                  }}
                                  className="bg-muted active:scale-[0.98] text-muted-foreground px-2.5 py-1 rounded text-[10.5px] font-bold flex items-center gap-1 border border-border shadow"
                                >
                                  <X className="w-3.5 h-3.5" /> 取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`rounded-xl px-3.5 py-2.5 shadow-sm text-sm border font-light tracking-wide transition-all cursor-pointer ${
                                isUser
                                  ? activeCharacter?.visualSettings?.userBubbleColor
                                    ? "border-transparent"
                                    : "bg-primary text-primary-foreground border-primary/50 hover:bg-primary/90"
                                  : activeCharacter?.visualSettings?.bubbleColor
                                    ? "border-transparent"
                                    : "bg-card text-foreground border-border shadow-sm"
                              }`}
                              style={{
                                backgroundColor: isUser
                                  ? activeCharacter?.visualSettings?.userBubbleColor || undefined
                                  : activeCharacter?.visualSettings?.bubbleColor || undefined,
                                color: isUser
                                  ? activeCharacter?.visualSettings?.userBubbleTextColor || undefined
                                  : activeCharacter?.visualSettings?.bubbleTextColor || undefined,
                              }}
                            >
                              {message.content === "💭..." ? (
                                <TypingIndicator />
                              ) : (
                                renderDialogueBubble(message.content)
                              )}
                            </div>
                          )}

                          {/* Bubble timestamp */}
                          <div
                            className={`text-[10px] text-muted-foreground font-mono mt-1 ${isUser ? "text-right" : "text-left"} flex gap-2 ${isUser ? "justify-end" : "justify-start"} flex-wrap`}
                          >
                            {roundNums[message.id] > 0 && (
                              <span className="flex items-center gap-1 opacity-70 text-primary font-medium">
                                第 {roundNums[message.id]} 轮对话
                              </span>
                            )}
                            <span className={roundNums[message.id] > 0 ? "border-l border-border pl-2" : ""}>
                              {new Date(message.timestamp).toLocaleTimeString(
                                undefined,
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </span>
                            {message.generationTime !== undefined && (
                              <span className="flex items-center gap-1 opacity-70 border-l border-border pl-2">
                                <Clock className="w-2.5 h-2.5" />
                                {message.generationTime.toFixed(1)}s
                              </span>
                            )}
                            {message.tokenCount !== undefined &&
                              message.tokenCount > 0 && (
                                <span
                                  className="flex items-center gap-1 opacity-70 border-l border-border pl-2"
                                  title={`提示词Tokens: ${message.promptTokenCount || 0}`}
                                >
                                  <Cpu className="w-2.5 h-2.5" />
                                  {message.tokenCount} Token
                                </span>
                              )}
                          </div>

                          {/* Quick Dialogue Options popup banner */}
                          {msgMenuId === message.id && (
                            <div
                              className={`absolute top-full mt-1.5 bg-popover text-popover-foreground border border-border rounded-lg p-1.5 flex items-center gap-1 shadow-2xl z-10 ${
                                isUser ? "right-0" : "left-0"
                              }`}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(
                                    message.content,
                                  );
                                  setMsgMenuId(null);
                                }}
                                className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1"
                              >
                                <Copy className="w-3 h-3" /> 复制
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingMsgId(message.id);
                                  setEditingMsgContent(message.content);
                                  setMsgMenuId(null);
                                }}
                                disabled={isSending}
                                className="text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Edit2 className="w-3 h-3" /> 编辑
                              </button>

                              {message.id !== activeSession?.messages[0]?.id && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMsgMenuId(null);
                                      handleRerollFromMessage(message);
                                    }}
                                    disabled={isSending}
                                    className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="从该对白开始重新生成后续回答"
                                  >
                                    <RefreshCw className="w-3 h-3" /> 重发
                                  </button>
                                )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMsgMenuId(null);
                                  createBacktrackBranch(message);
                                }}
                                disabled={isSending}
                                className="text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                title="从此处创立平行宇宙分支记录"
                              >
                                <GitFork className="w-3 h-3" /> 分支
                              </button>

                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const ok =
                                    await showCustomConfirm(
                                      "确定删除该单条对白台词吗？",
                                    );
                                  if (ok) {
                                    const nextMessages =
                                      activeSession.messages.filter(
                                        (m) => m.id !== message.id,
                                      );
                                    const updated = {
                                      ...activeSession,
                                      messages: nextMessages,
                                    };
                                    setSessions((prev) =>
                                      prev.map((s) =>
                                        s.id === updated.id ? updated : s,
                                      ),
                                    );
                                    await saveSession(updated);
                                    setMsgMenuId(null);
                                  }
                                }}
                                disabled={isSending}
                                className="text-[11px] text-red-500/80 hover:text-red-400 px-2 py-1 rounded active:scale-[0.98] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}

            {/* Typing Indicator */}
            {isSending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground italic pl-5">
                <div className="flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  ></span>
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  ></span>
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  ></span>
                </div>
                <span>{activeCharacter?.name} 正在雕琢语气并思索下文...</span>
              </div>
            )}

            {isSummarizing && (
              <div className="flex items-center gap-2 text-xs text-primary italic pl-5 py-1 animate-pulse">
                <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>系统正在整理潜意识碎片...</span>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          <ChatInputArea />
        </div>
      )}

      {/* Sub-tab 2: STORY TIMELINE YEARBOOK */}
      {chatSubTab === "timeline" && (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 min-h-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                故事历史卡片轴 (Memory Timeline)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                这些卡片将作为辅助长期记忆状态，拼写入系统 Prompt 中。
              </p>

            </div>
            <button
              onClick={() => {
                setNewSummaryTag(
                  `幕段 ${sessions.find((s) => s.id === activeSessionId)?.summaries?.length || 0}`,
                );
                setNewSummaryLoc(
                  activeCharacter?.scenario?.slice(0, 8) || "荒野野营",
                );
                setNewSummaryContent("");
                setNewSummaryCondition("");
                setNewSummaryInventory("");
                setNewSummaryBonding("");
                setTimelineModalOpen(true);
              }}
              className="bg-primary hover:bg-primary text-primary-foreground text-[11px] px-2.5 py-1.5 rounded transition flex items-center gap-1 font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> 手工补充
            </button>
          </div>

          <div className="relative border-l border-amber-655 border-primary/25 ml-3 pl-5 space-y-5 py-2">
            {activeSession?.summaries.map((summary) => (
              <div
                key={summary.id}
                className="relative group bg-card p-3 rounded-lg border border-border shadow-sm"
              >
                {/* Timeline Dot Indicator */}
                <span className="absolute -left-[25px] top-4 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background"></span>

                {/* Header summary node detail */}
                <div className="flex flex-col gap-1.5 mb-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-tight bg-primary/20 border border-amber-800/40 text-primary px-1.5 py-0.5 rounded">
                      ⏱ {summary.timeTag} · {summary.location}
                    </span>

                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => createBacktrackFromTimeline(summary)}
                        title="以此历史年表节点作为新旅程重演起点进行平行剧本推写"
                        className="text-muted-foreground hover:text-muted-foreground p-0.5 text-[10px] bg-muted border border-border px-1 py-0.5 rounded flex items-center gap-0.5 mr-1"
                      >
                        <GitFork className="w-2.5 h-2.5 text-primary" /> 分支宇宙
                      </button>
                      <button
                        onClick={() => {
                          setEditingSummaryId(summary.id);
                          setNewSummaryTag(summary.timeTag);
                          setNewSummaryLoc(summary.location);
                          setNewSummaryContent(summary.content);
                          setNewSummaryCondition(summary.condition || "");
                          setNewSummaryInventory(summary.inventory || "");
                          setNewSummaryBonding(summary.bonding || "");
                          setTimelineModalOpen(true);
                        }}
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="编辑该条记忆年表"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!activeSession) return;
                          const ok =
                            await showCustomConfirm(
                              "是否彻底解散清除该记忆卡片？",
                            );
                          if (ok) {
                             const nextSums = activeSession.summaries.filter(
                               (s) => s.id !== summary.id,
                             );
                             const updated = {
                               ...activeSession,
                               summaries: nextSums,
                               lastSummarizedMessageId: nextSums[nextSums.length - 1]?.lastMessageId || undefined,
                             };
                            setSessions((prev) =>
                              prev.map((s) =>
                                s.id === updated.id ? updated : s,
                              ),
                            );
                            await saveSession(updated);
                          }
                        }}
                        className="text-muted-foreground hover:text-red-400 p-1"
                        title="删除该条记忆年表"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Optional RPG State Badges */}
                  {((summary.condition && visibleExtensions.includes("condition")) || 
                    (summary.inventory && visibleExtensions.includes("inventory")) || 
                    (summary.bonding && visibleExtensions.includes("bonding"))) && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {summary.condition && visibleExtensions.includes("condition") && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-medium bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 px-1 py-0.5 rounded-md">
                          💓 {summary.condition}
                        </span>
                      )}
                      {summary.inventory && visibleExtensions.includes("inventory") && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-medium bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1 py-0.5 rounded-md">
                          🎒 {summary.inventory}
                        </span>
                      )}
                      {summary.bonding && visibleExtensions.includes("bonding") && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded-md">
                          🔗 {summary.bonding}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Summary prose item */}
                <p className="text-[12.5px] italic font-serif text-muted-foreground leading-relaxed font-light mt-1.5">
                  {summary.content}
                </p>
              </div>
            ))}

            {(!activeSession?.summaries ||
              activeSession.summaries.length === 0) && (
              <div className="text-center py-8 text-muted-foreground border border-dashed border-border/80 rounded pl-2">
                <Clock className="w-8 h-8 stroke-[1.2] mx-auto mb-1.5 opacity-60" />
                <p className="text-xs">目前尚未归档任何宏观发展大纲</p>
                <p className="text-[10px] leading-normal px-4 mt-1 opacity-70">
                  当聊天内容变长时，可通过下方 “智能记忆压缩”
                  自主浓缩，或手工录入您对当前关系演变的阶段性理解记录。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Hidden background script runtimes for TavernHelper compatibility */}
      {/* MVU compatibility: #tavern_helper container with data-script-id elements */}
      <div id="tavern_helper" style={{ display: "none" }} aria-hidden="true">
        {settings.enableScriptExecution &&
          activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
            if (script.enabled && script.content) {
              return (
                <div
                  key={script.id}
                  data-script-id={script.id}
                  data-script-name={script.name || "unnamed"}
                />
              );
            }
            return null;
          })}
      </div>
      {settings.enableScriptExecution &&
        activeCharacter?.extensions?.tavern_helper?.scripts?.map((script: any) => {
          if (script.enabled && script.content) {
            const srcDoc = createScriptIframeSrcDoc(script.content, script.id);
            return (
              <iframe
                key={script.id}
                id={`TH-script--${script.name || "unnamed"}--${script.id}`}
                name={script.name || "unnamed"}
                srcDoc={srcDoc}
                style={{ display: "none" }}
                // eslint-disable-next-line react/no-unknown-property
                sandbox="allow-scripts allow-same-origin"
                // Note: allow-same-origin + allow-scripts is intentionally used here.
                // The MVU bundle requires parent window access (TavernHelper, $, _ etc.)
                // and script execution. Scripts only run from user-imported character cards
                // with explicit enableScriptExecution setting enabled.
              />
            );
          }
          return null;
        })}
      <CharacterDetailDrawer
        isOpen={isDetailDrawerOpen}
        character={activeCharacter}
        onClose={() => setIsDetailDrawerOpen(false)}
      />
    </div>
  );
}
