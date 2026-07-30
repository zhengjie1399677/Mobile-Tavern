import React, { memo, useState } from "react";
import type { CharacterCard } from "../types";
import { useUnifiedApp } from "../UnifiedAppContext";
import { initTavernHelperMocks } from "../compatibility/sillytavern";
import { useLibsReady } from "./formatted-text/useLibsReady";
import {
  LocalErrorBoundary,
  parseMarkdownToReact,
  parseSafeHtmlToReact,
  preprocessFormattedText,
} from "./formatted-text/renderingRuntime";

interface WindowWithTavernHelperState extends Window {
  TavernHelperIsSending?: boolean;
}

interface FormattedTextProps {
  text: string;
  charName: string;
  userName?: string;
  className?: string;
  messageIndex?: number;
  character?: CharacterCard;
  isStreaming?: boolean;
}

const FormattedText = memo(function FormattedText({
  text,
  charName,
  userName = "user",
  className = "",
  messageIndex,
  character,
  isStreaming,
}: FormattedTextProps) {
  if (!text) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const isTooLong = text.length > 50000;
  const isWidget = /```html\b|<iframe\b|<StatusPlaceHolder/i.test(text);
  const shouldTruncate = isTooLong && !isExpanded && !isWidget;
  const displayText = shouldTruncate
    ? `${text.substring(0, 45000)}\n\n*... [ 此处已自动折叠超长内容，当前共 ${text.length} 字 ] ...*`
    : text;

  const context = useUnifiedApp((state) => ({
    settings: state.settings,
    activeCharacter: state.activeCharacter,
    activeSession: state.activeSession,
    isSending: state.isSending,
  }));
  const enableHtml = context.settings.enableHtmlRendering ?? true;
  const enableScriptExecution = Boolean(context.settings.enableScriptExecution);
  const enableLoopProtection = context.settings.enableLoopProtection !== false;
  const activeCharacter = character ?? context.activeCharacter;

  if (enableScriptExecution) {
    initTavernHelperMocks();
  }

  const libsReady = useLibsReady(enableScriptExecution);
  const enableAsteriskFormatting =
    activeCharacter?.visualSettings?.enableAsteriskFormatting !== undefined
      ? Boolean(activeCharacter.visualSettings.enableAsteriskFormatting)
      : Boolean(context.settings.enableAsteriskFormatting);
  const { isSending, activeSession } = context;
  const isSendingSync = Boolean(
    isSending ||
      (typeof window !== "undefined" &&
        (window as WindowWithTavernHelperState).TavernHelperIsSending),
  );
  const isStreamingLastMessage =
    isStreaming ??
    Boolean(
      isSendingSync &&
        activeSession &&
        messageIndex !== undefined &&
        messageIndex === activeSession.messages.length - 1,
    );

  if (enableScriptExecution && messageIndex !== undefined && text.length > 10) {
    const hasCodeBlock = /```/.test(text);
    if (hasCodeBlock || isStreamingLastMessage) {
      console.log(
        `[FT-DIAG] msgIdx=${messageIndex}, isSending=${isSending}, sessLen=${activeSession?.messages?.length}, isStreamLast=${isStreamingLastMessage}, hasCodeBlock=${hasCodeBlock}, textLen=${text.length}`,
      );
    }
  }

  const isAiMessage = (() => {
    if (character && messageIndex === undefined) return true;
    if (messageIndex === undefined || !activeSession?.messages) return false;
    return activeSession.messages[messageIndex]?.sender === "assistant";
  })();

  const processed = preprocessFormattedText(
    displayText,
    charName,
    userName,
    activeCharacter,
    enableScriptExecution,
    context.settings.globalRegexScripts,
    context.settings.presetRegexScripts,
    messageIndex,
    enableLoopProtection,
    isAiMessage,
    isStreamingLastMessage,
  );
  const hasHtml = enableHtml && /<[a-z/][\s\S]*?>/i.test(processed);
  const swipeId =
    messageIndex === undefined
      ? 0
      : (activeSession?.messages?.[messageIndex]?.swipe_id ?? 0);

  const renderedContent = hasHtml ? (
    <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
      {parseSafeHtmlToReact(
        processed,
        enableAsteriskFormatting,
        enableScriptExecution,
        activeCharacter,
        messageIndex,
        libsReady,
        enableLoopProtection,
        swipeId,
      )}
    </span>
  ) : (
    <span className={`whitespace-pre-wrap leading-relaxed ${className}`}>
      {parseMarkdownToReact(processed, enableAsteriskFormatting, "text-node")}
    </span>
  );

  const expandableContent = (
    <div className="relative w-full">
      <div
        className={shouldTruncate ? "max-h-[600px] overflow-hidden relative transition-all duration-300" : "relative"}
        style={shouldTruncate ? {
          maskImage: "linear-gradient(to bottom, black 80%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 80%, transparent 100%)",
        } : {}}
      >
        {renderedContent}
      </div>
      <div className={`flex justify-center w-full mt-3 ${shouldTruncate ? "absolute bottom-0 left-0 py-4 bg-gradient-to-t from-background/95 to-transparent pt-16" : ""}`}>
        <button
          onClick={() => setIsExpanded((expanded) => !expanded)}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full border border-primary/20 bg-background/90 text-primary shadow-sm active:scale-95 transition-all hover:bg-accent backdrop-blur-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
            />
          </svg>
          {isExpanded ? "收起" : "展开"}超长台词 (共 {text.length} 字)
        </button>
      </div>
      {shouldTruncate && <div className="h-8" />}
    </div>
  );

  const fallback = (
    <span className={`block whitespace-pre-wrap leading-relaxed ${className}`}>
      {text}
    </span>
  );

  return (
    <LocalErrorBoundary fallback={fallback}>
      {shouldTruncate || (isTooLong && !isWidget && isExpanded)
        ? expandableContent
        : renderedContent}
    </LocalErrorBoundary>
  );
});

export default FormattedText;
