// 输入区子组件（含建议词、长按、键盘联动）
// 从原 ChatTab.tsx L39-470 抽离
// 内部调用 useUnifiedApp() 获取上下文，接收 isKeyboardOpen 作为 prop

import React from "react";
import {
  Send,
  Brain,
  RefreshCw,
  Cpu,
  Square,
  Sliders,
  Mic,
  MicOff,
  Loader2,
} from "lucide-react";
import { UnifiedAppContext } from "../../UnifiedAppContext";
import { chatTabState } from "./utils";

const ChatInputArea = ({ isKeyboardOpen }: { isKeyboardOpen: boolean }) => {
  const [showQuickActions, setShowQuickActions] = React.useState(false);
  const context = React.useContext(UnifiedAppContext);
  if (!context) return null;
  const {
    isSending,
    setIsSending,
    activeSession,
    settings,
    activeCharacter,
    handleRerollLast,
    showCustomConfirm,
    showCustomAlert,
    handleAutoSummaryCheck,

    handleSendMessage,
    handleStopGeneration,
    safeAreas,
    userInputMessage,
    setUserInputMessage,
    replySuggestions,
    setReplySuggestions,
    updateSettings,
    isBisonLocking,
    triggerScroll,
    getKernelService,
  } = context;


  React.useEffect(() => {
    let scrollRafId: number | null = null;
    const handleWindowScroll = () => {
      if (
        window.scrollY !== 0 ||
        window.scrollX !== 0 ||
        document.body.scrollTop !== 0 ||
        document.documentElement.scrollTop !== 0
      ) {
        if (scrollRafId) cancelAnimationFrame(scrollRafId);
        scrollRafId = requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
          document.documentElement.scrollTop = 0;
        });
      }
    };
    window.addEventListener("scroll", handleWindowScroll, { passive: false });

    const resetScroll = () => {
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      scrollRafId = requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      });
    };

    const vvp = window.visualViewport;
    if (vvp) {
      vvp.addEventListener("resize", resetScroll);
    }

    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      if (vvp) {
        vvp.removeEventListener("resize", resetScroll);
      }
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
    };
  }, []);

  // 优先从全局闭包变量中读取以抗御组件销毁重装，否则继承 settings
  const [clickMode, setClickMode] = React.useState<"send" | "fill">(
    chatTabState.suggestionsClickMode || settings.replySuggestionsClickMode || "fill"
  );
  // Ref 始终同步最新 clickMode，供事件处理函数使用，彻底避免陈旧闭包
  const clickModeRef = React.useRef<"send" | "fill">(clickMode);
  React.useEffect(() => {
    clickModeRef.current = clickMode;
  }, [clickMode]);

  React.useEffect(() => {
    if (settings.replySuggestionsClickMode) {
      if (chatTabState.suggestionsClickMode !== settings.replySuggestionsClickMode) {
        chatTabState.suggestionsClickMode = settings.replySuggestionsClickMode;
        setClickMode(settings.replySuggestionsClickMode);
      }
    }
  }, [settings.replySuggestionsClickMode]);

  const [localInput, setLocalInput] = React.useState(userInputMessage);

  const [isRecording, setIsRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);

  const handleToggleAsr = async () => {
    try {
    const asrService = getKernelService<any>("asr");
      if (isRecording) {
        setIsRecording(false);
        if (settings.asrConfig?.provider === "openai") {
          setIsTranscribing(true);
        }
        asrService.stopListening();
      } else {
        setIsRecording(true);
        setIsTranscribing(false);
        let initialText = localInput;

        await asrService.startListening(
          settings.asrConfig || {
            enabled: true,
            provider: "web-speech",
            language: "zh-CN",
          },
          (text: string, isFinal: boolean) => {
            if (settings.asrConfig?.provider === "web-speech") {
              const newText = initialText ? `${initialText} ${text}` : text;
              setLocalInput(newText);
              setUserInputMessage(newText);
              if (isFinal) {
                initialText = newText;
              }
            } else {
              const newText = localInput ? `${localInput} ${text}` : text;
              setLocalInput(newText);
              setUserInputMessage(newText);
            }
          },
          (err: any) => {
            console.error("ASR Error:", err);
            setIsRecording(false);
            setIsTranscribing(false);
            
            const errMsg = err.message || String(err);
            if (errMsg.includes("not-allowed") || errMsg.includes("Permission denied") || errMsg.includes("NotAllowedError") || errMsg.includes("permission denied")) {
              showCustomAlert(
                "🎙️ 麦克风权限已被拒绝！\n\n请在您的手机系统设置或浏览器设置中，为本应用开启麦克风录音权限，然后重试。",
                "权限错误"
              );
            } else if (errMsg.includes("no-speech")) {
              showCustomAlert("🎙️ 未检测到您的声音，请说话大声一点，或者检查您的麦克风。", "未检测到语音");
            } else if (errMsg.includes("audio-capture")) {
              showCustomAlert("🎙️ 未找到麦克风设备，请确保您的设备录音硬件正常工作。", "设备错误");
            } else {
              showCustomAlert(`🎙️ 语音输入失败: ${errMsg}`, "识别错误");
            }
          },
          () => {
            setIsRecording(false);
            setIsTranscribing(false);
          }
        );
      }
    } catch (e) {
      console.error("ASR Toggle Error:", e);
      setIsRecording(false);
      setIsTranscribing(false);
    }
  };

  React.useEffect(() => {
    setLocalInput(userInputMessage);
  }, [userInputMessage]);

  const localInputRef = React.useRef(localInput);
  React.useEffect(() => {
    localInputRef.current = localInput;
  }, [localInput]);

  React.useEffect(() => {
    return () => {
      setUserInputMessage(localInputRef.current);
    };
  }, [activeSession?.id]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(42, Math.min(textarea.scrollHeight, 160))}px`;

    // 用户在输入长文本换行导致输入框高度改变时，若软键盘处于打开状态且聚焦，通过滚动消息历史确保最新可见，不顶起整个视口
    if (isKeyboardOpen && document.activeElement === textarea) {
      triggerScroll("auto");
    }
  }, [localInput, isKeyboardOpen, triggerScroll]);

  React.useEffect(() => {
    let timeoutId: any = null;
    const scrollInputIntoView = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      if (document.activeElement !== textarea) return;
      triggerScroll("auto");
    };

    if (isKeyboardOpen) {
      scrollInputIntoView();
      // 等待软键盘展开动画结束、视口高度调整彻底稳定执行二次修正
      timeoutId = setTimeout(() => {
        scrollInputIntoView();
      }, 250);
    }

    // 监听聚焦，如果是聚焦，也延迟滚动以防万一
    const textarea = textareaRef.current;
    const handleFocus = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        scrollInputIntoView();
      }, 300);
    };

    if (textarea) {
      textarea.addEventListener("focus", handleFocus);
    }

    return () => {
      if (textarea) {
        textarea.removeEventListener("focus", handleFocus);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isKeyboardOpen, triggerScroll]);

  const lastMsgIsUser = React.useMemo(() => {
    if (!activeSession || !Array.isArray(activeSession.messages) || activeSession.messages.length === 0) return false;
    return activeSession.messages[activeSession.messages.length - 1].sender === "user";
  }, [activeSession]);

  const canSend = React.useMemo(() => {
    const hasInput = (localInput || "").trim() !== "";
    if (settings.enableMultiMessageQueue) {
      return hasInput || lastMsgIsUser;
    }
    return hasInput;
  }, [localInput, settings.enableMultiMessageQueue, lastMsgIsUser]);

  const onSendPure = React.useCallback(() => {
    if (!localInput.trim()) return;
    const msg = localInput;
    setLocalInput("");
    setUserInputMessage("");
    setReplySuggestions([]);
    handleSendMessage(msg, { skipAI: true });
  }, [localInput, handleSendMessage]);

  const onSendMerged = React.useCallback(() => {
    const msg = localInput.trim();
    setLocalInput("");
    setUserInputMessage("");
    setReplySuggestions([]);
    handleSendMessage(msg, { skipAI: false });
  }, [localInput, handleSendMessage]);

  const longPressTimerRef = React.useRef<any>(null);
  const hasTriggeredLongPress = React.useRef(false);

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (isSending) return;
    if (!settings.enableMultiMessageQueue) return;

    hasTriggeredLongPress.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      hasTriggeredLongPress.current = true;
      onSendMerged();
    }, 500);
  }, [isSending, onSendMerged, settings.enableMultiMessageQueue]);

  const handlePointerUp = React.useCallback((e: React.PointerEvent) => {
    if (!settings.enableMultiMessageQueue) {
      onSendMerged();
      return;
    }

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!hasTriggeredLongPress.current) {
      onSendPure();
    }
    hasTriggeredLongPress.current = false;
  }, [onSendPure, onSendMerged, settings.enableMultiMessageQueue]);

  const handlePointerCancel = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    hasTriggeredLongPress.current = false;
  }, []);

  const handleSelectSuggestion = (e: React.MouseEvent | React.TouchEvent, suggestion: string) => {
    if (e && e.cancelable) {
      e.preventDefault();
    }
    if (e.type === "touchstart") {
      (e.currentTarget as any)._touched = true;
    } else if (e.type === "mousedown") {
      if ((e.currentTarget as any)._touched) {
        (e.currentTarget as any)._touched = false;
        return;
      }
    }

    // 优先读取同步更新的全局变量，再降级到 Ref，彻底消除 React 调度时序导致的陈旧读取
    const currentMode = chatTabState.suggestionsClickMode ?? clickModeRef.current;
    if (currentMode === "send") {
      setLocalInput("");
      setUserInputMessage("");
      setReplySuggestions([]);
      handleSendMessage(suggestion);
    } else {
      setLocalInput(suggestion);
      setUserInputMessage(suggestion);
    }
  };

  return (
    <div
      id="chat-input-area-container"
      ref={containerRef}
      style={{
        paddingBottom: `${isKeyboardOpen ? 4 : Math.max(safeAreas?.bottom ?? 0, 10)}px`
      }}
      className="glass-panel border-t border-border/40 pt-2 px-3 flex flex-col gap-1.5 z-10 shrink-0 shadow-[0_-8px_30px_rgb(0,0,0,0.04)]"
    >
      {showQuickActions && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 rounded-lg border border-border/20 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleRerollLast()}
              disabled={
                isSending ||
                !activeSession ||
                !Array.isArray(activeSession.messages) ||
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

          <div
            aria-hidden="true"
            className="flex items-center gap-1.5 text-muted-foreground font-mono text-[9px] opacity-75"
          >
            <Cpu className="w-3 h-3" />
            <span>
              预测: ~
              {Math.ceil(
                (localInput || "").length * 1.5 +
                  ((Array.isArray(activeSession?.messages)
                    ? activeSession.messages.slice(-settings.memory.recentTurns)
                    : []
                  ).reduce(
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
      )}
      {settings.enableReplySuggestions && !isSending && replySuggestions && replySuggestions.length > 0 && (
        <div className="flex flex-col gap-1.5 px-1 py-1 border-b border-border/30 animate-fadeIn">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium px-1">
            <span className="flex items-center gap-1">✨ 叙事分支生成器:</span>
            <button
              onClick={() => {
                const nextMode = clickMode === "send" ? "fill" : "send";
                // 同步更新全局变量与 Ref，确保 handleSelectSuggestion 在本次事件循环内即可读到最新值
                chatTabState.suggestionsClickMode = nextMode;
                clickModeRef.current = nextMode;
                setClickMode(nextMode);
                updateSettings((prev: any) => ({
                  ...prev,
                  replySuggestionsClickMode: nextMode,
                }));
              }}
              className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-[9px] font-semibold flex items-center gap-1 border border-border transition active:scale-95"
            >
              点击行为: {clickMode === "send" ? "直接发送" : "填入框内"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5 py-1.5 px-0.5">
            {replySuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onMouseDown={(e) => handleSelectSuggestion(e, suggestion)}
                onTouchStart={(e) => handleSelectSuggestion(e, suggestion)}
                onClick={(e) => {
                  e.preventDefault();
                }}
                className="w-full px-3 py-2 rounded-lg text-[11px] font-normal leading-normal text-left text-foreground bg-primary/5 hover:bg-primary/10 border border-primary/15 hover:border-primary/30 transition active:scale-95 shadow-sm truncate"
                title={suggestion}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 relative">
        <button
          onClick={() => setShowQuickActions(prev => !prev)}
          className={`p-2.5 rounded-xl border hover:bg-muted text-muted-foreground transition-all duration-200 shrink-0 ${
            showQuickActions ? "text-primary bg-primary/10 border-primary/20" : "bg-input/30 border-border/80"
          }`}
          title="切换显示发包预测与快捷工具"
        >
          <Sliders className="w-4 h-4" />
        </button>
        <textarea
          ref={textareaRef}
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (settings.enableMultiMessageQueue) {
                onSendPure();
              } else {
                onSendMerged();
              }
            }
          }}
          disabled={isBisonLocking || isSending}
          inputMode="text"
          enterKeyHint="send"
          placeholder={
            isBisonLocking
              ? `${activeCharacter?.name || "角色"} 正在继续发言...`
              : isRecording
                ? "正在倾听语音输入，请说话..."
                : isTranscribing
                  ? "正在转译语音为文字..."
                  : `发送一条对白至 ${activeCharacter?.name} 启程...`
          }
          aria-label={`发送给 ${activeCharacter?.name || "角色"} 的消息输入框`}
          rows={2}
          className={`flex-1 bg-input/70 border border-border/80 rounded-xl py-2 px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:bg-background/95 resize-none font-light overflow-y-auto max-h-[160px] min-h-[42px] transition-[border-color,background-color] duration-300 shadow-inner ${
            (isBisonLocking || isSending) ? "opacity-50 cursor-not-allowed text-muted-foreground" : ""
          }`}
        />
        {settings.asrConfig?.enabled && (
          <button
            type="button"
            onClick={handleToggleAsr}
            disabled={isSending || isBisonLocking}
            className={`w-[42px] h-[42px] rounded-xl border transition-all duration-300 shrink-0 flex items-center justify-center ${
              isRecording
                ? "bg-red-500/20 border-red-500/40 text-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                : isTranscribing
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-500"
                  : "bg-input/30 border-border/80 text-muted-foreground hover:bg-muted"
            } ${(isSending || isBisonLocking) ? "opacity-45 cursor-not-allowed" : "active:scale-95"}`}
            title={isRecording ? "停止录音" : isTranscribing ? "正在识别中..." : "语音输入"}
          >
            {isTranscribing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRecording ? (
              <Mic className="w-4 h-4 animate-bounce" />
            ) : (
              <Mic className="w-4 h-4 opacity-70" />
            )}
          </button>
        )}
        {isSending ? (
          <button
            onClick={() => handleStopGeneration()}
            aria-label="中止对话"
            title="中止对话"
            className="w-[42px] h-[42px] rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all duration-300 shadow-md flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
          >
            <Square className="w-4 h-4 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerCancel}
            disabled={!canSend}
            aria-label={
              settings.enableMultiMessageQueue
                ? "发送消息（长按合并发送）"
                : "发送消息"
            }
            title={
              settings.enableMultiMessageQueue
                ? "点击单纯发送消息，长按500ms与之前消息合并发送给AI"
                : "发送消息"
            }
            className={`w-[42px] h-[42px] rounded-xl bg-primary text-primary-foreground transition-all duration-300 shadow-md flex items-center justify-center shrink-0 active:scale-95 ${
              canSend
                ? "hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 hover:-translate-y-0.5 cursor-pointer opacity-100"
                : "opacity-45 cursor-not-allowed bg-muted text-muted-foreground shadow-none"
            }`}
          >
            <Send className={`w-4 h-4 transition-transform duration-300 ${canSend ? "scale-110" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInputArea;
