import type React from "react";
import { Brain, Check, ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import type { Message } from "../../../types";

interface ReasoningBlockProps {
  message: Message;
  isStreaming: boolean;
  isSending: boolean;
  expandedIds: Record<string, boolean>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedIds: Record<string, boolean>;
  setCopiedIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function ReasoningBlock({
  message,
  isStreaming,
  isSending,
  expandedIds,
  setExpandedIds,
  copiedIds,
  setCopiedIds,
}: ReasoningBlockProps) {
  const { t } = useTranslation();
  const reasoning = message.reasoningContent;
  if (!reasoning) return null;

  const isExpanded = expandedIds[message.id];

  const copyReasoning = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(reasoning);
    }
    setCopiedIds((previous) => ({ ...previous, [message.id]: true }));
    setTimeout(() => {
      setCopiedIds((previous) => ({ ...previous, [message.id]: false }));
    }, 1500);
  };

  return (
    <div className="mb-2 text-xs max-w-sm">
      <div
        onClick={() => {
          setExpandedIds((previous) => ({
            ...previous,
            [message.id]: !previous[message.id],
          }));
        }}
        className="bg-muted/40 hover:bg-muted/60 border-border/30 text-muted-foreground cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-semibold select-none transition-all active:scale-95 w-fit"
      >
        <Brain className={`w-3.5 h-3.5 ${isStreaming ? "animate-pulse text-primary" : "opacity-75"}`} />
        <span>
          {isExpanded
            ? t("message_bubble.reasoning_collapse")
            : isStreaming
              ? t("message_bubble.reasoning_thinking")
              : t("message_bubble.reasoning_view")}
        </span>
        {!isSending && (
          <span className="text-muted-foreground/60 font-normal">
            · {t("message_bubble.reasoning_chars", { length: String(reasoning.length) })}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </div>

      {isExpanded && (
        <div className="mt-1.5 relative">
          <div className="p-3 pr-8 rounded-xl glass-panel border border-border/20 text-muted-foreground font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar animate-in fade-in duration-300">
            {reasoning}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary/70 animate-pulse" />
            )}
          </div>
          {!isSending && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                copyReasoning();
              }}
              className="absolute top-1.5 right-1.5 p-1 rounded-md hover:bg-muted/80 text-muted-foreground/60 hover:text-foreground transition-colors"
              title={t("message_bubble.copy_reasoning")}
            >
              {copiedIds[message.id] ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
