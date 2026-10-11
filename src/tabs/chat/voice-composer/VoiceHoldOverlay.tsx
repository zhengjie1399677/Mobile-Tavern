import React from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";

/** 录音时长格式化（mm:ss）。 */
export function formatVoiceDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface VoiceHoldOverlayProps {
  isCancelHovered: boolean;
  /** 接近上限：转警示色并预告自动发送。 */
  isLimitWarning: boolean;
  amplitude: number;
  holdDurationMs: number;
}

/** 按住说话的全屏遮罩：波形、时长、上滑取消与到点自动发送预告。 */
export function VoiceHoldOverlay({
  isCancelHovered,
  isLimitWarning,
  amplitude,
  holdDurationMs,
}: VoiceHoldOverlayProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/30 backdrop-blur-[2px] transition-opacity duration-200">
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl px-8 py-6 shadow-2xl transition-all duration-200 ${
          isCancelHovered
            ? "bg-red-950/90 border border-red-500/50 text-red-200 scale-105"
            : isLimitWarning
              ? "bg-amber-950/90 border border-amber-500/50 text-amber-100"
              : "bg-background/90 border border-border/80 text-foreground"
        } backdrop-blur-md`}
        style={{ minWidth: 200, minHeight: 160 }}
      >
        {isCancelHovered ? (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-red-500/20 text-red-400">
              <RotateCcw className="size-7" />
            </div>
            <span className="text-sm font-semibold text-red-300">
              {t("chat_input.voice_release_to_cancel")}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 h-10 px-2">
              {[0.4, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6].map((scale, i) => {
                const height = Math.max(8, Math.min(36, 10 + amplitude * 26 * scale));
                return (
                  <div
                    key={i}
                    className={`w-1.5 rounded-full transition-all duration-75 ${
                      isLimitWarning ? "bg-amber-400" : "bg-primary"
                    }`}
                    style={{ height: `${height}px` }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium tracking-wider">
                {formatVoiceDuration(holdDurationMs)} / 03:00
              </span>
            </div>
            <span className={`text-xs ${isLimitWarning ? "text-amber-200/90" : "text-muted-foreground"}`}>
              {isLimitWarning
                ? t("chat_input.voice_limit_warning")
                : t("chat_input.voice_release_to_send")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
