import React from "react";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { useTranslation } from "../../../contexts/LanguageContext";
import { chatTabState } from "../utils";
import type { ReplyChoice } from "../../../types";

/**
 * 用于在事件 currentTarget 上标记 _touched 状态，
 * 以区分 touchstart 与 mousedown 事件，避免移动端重复触发。
 */
type TouchTrackedElement = Element & { _touched?: boolean };

interface ComposerReplySuggestionsProps {
  /** 输入框正在展示 / 命令候选时让位，避免两层浮层叠在一起。 */
  commandSuggestionsVisible: boolean;
}

/**
 * 叙事分支生成器面板：点击行为（直接发送 / 填入框内）可切换并持久化到设置。
 * 点击行为同时写入模块级 `chatTabState`，确保在本次事件循环内即可读到最新值。
 */
export function ComposerReplySuggestions({ commandSuggestionsVisible }: ComposerReplySuggestionsProps) {
  const { t } = useTranslation();
  const {
    isSending,
    settings,
    replySuggestions,
    setReplySuggestions,
    updateSettings,
    handleSendMessage,
    setUserInputMessage,
  } = useUnifiedApp((state) => ({
    isSending: state.isSending,
    settings: state.settings,
    replySuggestions: state.replySuggestions,
    setReplySuggestions: state.setReplySuggestions,
    updateSettings: state.updateSettings,
    handleSendMessage: state.handleSendMessage,
    setUserInputMessage: state.setUserInputMessage,
  }));

  const [clickMode, setClickMode] = React.useState<"send" | "fill">(
    chatTabState.suggestionsClickMode || settings?.replySuggestionsClickMode || "fill"
  );
  // Ref 始终同步最新 clickMode，供事件处理函数使用，彻底避免陈旧闭包
  const clickModeRef = React.useRef<"send" | "fill">(clickMode);
  React.useEffect(() => {
    clickModeRef.current = clickMode;
  }, [clickMode]);

  React.useEffect(() => {
    if (settings?.replySuggestionsClickMode) {
      if (chatTabState.suggestionsClickMode !== settings.replySuggestionsClickMode) {
        chatTabState.suggestionsClickMode = settings.replySuggestionsClickMode;
        setClickMode(settings.replySuggestionsClickMode);
      }
    }
  }, [settings?.replySuggestionsClickMode]);

  const handleSelectSuggestion = (e: React.MouseEvent | React.TouchEvent, suggestion: ReplyChoice) => {
    if (e && e.cancelable) {
      e.preventDefault();
    }
    if (e.type === "touchstart") {
      (e.currentTarget as TouchTrackedElement)._touched = true;
    } else if (e.type === "mousedown") {
      if ((e.currentTarget as TouchTrackedElement)._touched) {
        (e.currentTarget as TouchTrackedElement)._touched = false;
        return;
      }
    }

    // 优先读取同步更新的全局变量，再降级到 Ref，彻底消除 React 调度时序导致的陈旧读取
    const currentMode = chatTabState.suggestionsClickMode ?? clickModeRef.current;
    if (currentMode === "send") {
      // 输入区的 localInput 由 userInputMessage 单向同步，这里只写权威来源。
      setUserInputMessage("");
      setReplySuggestions([]);
      void handleSendMessage(suggestion.prompt).catch((err) => {
        console.error("Failed to send suggestion prompt:", err);
      });
    } else {
      setUserInputMessage(suggestion.prompt);
    }
  };

  if (!settings.enableReplySuggestions || isSending || commandSuggestionsVisible) return null;
  if (!replySuggestions || replySuggestions.length === 0) return null;

  return (
    <div className="chat-composer-popover flex w-full max-w-3xl flex-col gap-1.5 rounded-2xl p-2 animate-fadeIn">
      <div className="flex items-center justify-between text-xs text-muted-foreground font-medium px-1">
        <span className="flex items-center gap-1">{t("chat_input.suggestions_label")}</span>
        <button
          onClick={() => {
            const nextMode = clickMode === "send" ? "fill" : "send";
            // 同步更新全局变量与 Ref，确保 handleSelectSuggestion 在本次事件循环内即可读到最新值
            chatTabState.suggestionsClickMode = nextMode;
            clickModeRef.current = nextMode;
            setClickMode(nextMode);
            updateSettings((prev) => ({
              ...prev,
              replySuggestionsClickMode: nextMode,
            }));
          }}
          className="flex min-h-11 items-center gap-1 rounded border border-border bg-muted px-2 text-xs font-semibold transition hover:bg-muted/80 active:scale-95"
        >
          {t("chat_input.click_mode", { mode: clickMode === "send" ? t("chat_input.click_mode_send") : t("chat_input.click_mode_fill") })}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 py-1.5 px-0.5">
        {replySuggestions.map((suggestion, idx) => (
          <button
            key={suggestion.id || idx}
            onMouseDown={(e) => handleSelectSuggestion(e, suggestion)}
            onTouchStart={(e) => handleSelectSuggestion(e, suggestion)}
            onClick={(e) => {
              e.preventDefault();
            }}
            className="min-h-11 w-full rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-left text-xs font-normal leading-normal text-foreground shadow-sm transition hover:border-primary/30 hover:bg-primary/10 active:scale-95"
            title={suggestion.description || suggestion.prompt}
          >
            <span className="block truncate font-medium">{suggestion.label}</span>
            {suggestion.description && (
              <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{suggestion.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
