import React from "react";
import { Mic, Radio, RotateCcw } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";

interface VoiceHoldButtonProps {
  isHolding: boolean;
  isCancelHovered: boolean;
  disabled: boolean;
  /** 由 useChatVoiceInput 提供，含指针捕获、多指守卫与上滑取消阈值。 */
  pointerHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  };
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onHoldCancel: () => void;
}

/**
 * 「按住 说话」按钮。
 *
 * 除指针手势外还提供键盘与读屏路径：Space/Enter 起止、失焦必取消（不能让麦克风留在开启状态），
 * 以及 TalkBack 合成的 click（`detail === 0`，它不会派发 pointerdown）。
 */
export function VoiceHoldButton({
  isHolding,
  isCancelHovered,
  disabled,
  pointerHandlers,
  onHoldStart,
  onHoldEnd,
  onHoldCancel,
}: VoiceHoldButtonProps) {
  const { t } = useTranslation();
  const keyboardHoldingRef = React.useRef(false);

  const label = isHolding
    ? isCancelHovered
      ? t("chat_input.voice_release_to_cancel")
      : t("chat_input.voice_release_to_send")
    : t("chat_input.voice_hold");

  return (
    <button
      type="button"
      aria-pressed={isHolding}
      aria-label={t("chat_input.voice_hold")}
      onPointerDown={pointerHandlers.onPointerDown}
      onPointerMove={pointerHandlers.onPointerMove}
      onPointerUp={pointerHandlers.onPointerUp}
      onPointerCancel={pointerHandlers.onPointerCancel}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          if (keyboardHoldingRef.current || isHolding) return;
          keyboardHoldingRef.current = true;
          onHoldStart();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!keyboardHoldingRef.current) return;
          keyboardHoldingRef.current = false;
          onHoldEnd();
        }
      }}
      onBlur={() => {
        // 指针按住的生命周期由 pointerup/pointercancel 管理；只有键盘按住
        // 在失焦时必须取消，避免滑过快捷栏等元素时把正在进行的录音误断。
        if (!keyboardHoldingRef.current) return;
        keyboardHoldingRef.current = false;
        onHoldCancel();
      }}
      onClick={(event) => {
        // 键盘与指针路径已各自处理；这里只兜住读屏合成的 click。
        if (event.detail !== 0 || keyboardHoldingRef.current) return;
        if (isHolding) onHoldEnd();
        else onHoldStart();
      }}
      disabled={disabled}
      className={`group min-h-[38px] flex-1 select-none rounded-xl border-0 font-medium text-sm transition-all duration-150 flex items-center justify-center touch-none py-2 px-3 ${
        isHolding
          ? isCancelHovered
            ? "bg-red-500/15 text-red-400 font-semibold shadow-inner scale-[0.98]"
            : "bg-primary/15 text-primary font-semibold shadow-inner scale-[0.98]"
          : "bg-muted/40 text-foreground/90 hover:bg-muted/70 active:bg-muted/90 active:scale-[0.99]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {isHolding ? (
        isCancelHovered ? (
          <RotateCcw className="mr-1.5 size-4 animate-spin text-red-400" />
        ) : (
          <Radio className="mr-1.5 size-4 animate-pulse text-primary" />
        )
      ) : (
        <Mic className="mr-1.5 size-4 opacity-60 transition-transform group-hover:scale-110" />
      )}
      <span>{label}</span>
    </button>
  );
}
