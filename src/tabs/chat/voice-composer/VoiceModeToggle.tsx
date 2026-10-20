import React from "react";
import { Keyboard, Mic } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";

interface VoiceModeToggleProps {
  isVoiceMode: boolean;
  /** 持握中必须禁用：卸载按住按钮会让指针捕获被隐式释放，录音器与遮罩会被搁浅。 */
  disabled: boolean;
  onToggle: () => void;
}

/** 键盘 / 按住说话模式切换。 */
export function VoiceModeToggle({ isVoiceMode, disabled, onToggle }: VoiceModeToggleProps) {
  const { t } = useTranslation();
  const label = isVoiceMode
    ? t("chat_input.voice_switch_to_keyboard")
    : t("chat_input.voice_switch_to_voice");

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className="flex size-[38px] shrink-0 items-center justify-center rounded-xl border-0 text-muted-foreground transition-all duration-200 hover:bg-muted/70 hover:text-foreground active:scale-95 disabled:opacity-45"
      title={label}
    >
      {isVoiceMode ? <Keyboard className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}
