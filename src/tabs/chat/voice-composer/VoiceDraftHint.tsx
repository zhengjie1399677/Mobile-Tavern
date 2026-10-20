import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";

interface VoiceDraftHintProps {
  draft: string;
  onClear: () => void;
}

/**
 * 语音模式下显示草稿：语音会连同这段文字一起发送，
 * 而不是像以前那样在 textarea 被卸载后不可见地发出、随后被清空。
 */
export function VoiceDraftHint({ draft, onClear }: VoiceDraftHintProps) {
  const { t } = useTranslation();
  const text = draft.trim();
  if (!text) return null;

  return (
    <div className="flex w-full max-w-3xl items-center gap-2 rounded-xl bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm transition-all mb-1">
      <span className="shrink-0">{t("chat_input.voice_draft_label")}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{text}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("chat_input.voice_draft_clear")}
        title={t("chat_input.voice_draft_clear")}
        className="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted active:scale-95"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
