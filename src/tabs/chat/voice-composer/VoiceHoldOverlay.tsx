import React from "react";
import { ArrowUp, RotateCcw } from "lucide-react";
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
  /** 上滑进度（0–1）：用于放大取消提示，让“滑到位再取消”可见。 */
  cancelSwipeProgress: number;
  /** 接近上限：转警示色并预告自动发送。 */
  isLimitWarning: boolean;
  amplitude: number;
  holdDurationMs: number;
}

/** 对称音浪权重映射（中间高两头低）。 */
const WAVE_BAR_SCALES = [0.25, 0.4, 0.6, 0.8, 0.95, 1.0, 0.9, 0.9, 1.0, 0.95, 0.8, 0.6, 0.4, 0.25];

/** 按住说话的全屏遮罩：波形、时长、上滑取消与到点自动发送预告。 */
export function VoiceHoldOverlay({
  isCancelHovered,
  cancelSwipeProgress,
  isLimitWarning,
  amplitude,
  holdDurationMs,
}: VoiceHoldOverlayProps) {
  const { t } = useTranslation();
  const progress = Math.max(0, Math.min(1, cancelSwipeProgress));

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/35 backdrop-blur-sm transition-opacity duration-200">
      <div
        className={`flex w-72 flex-col items-center justify-center gap-3.5 rounded-3xl px-6 py-6 transition-all duration-200 backdrop-blur-2xl ring-1 ${
          isCancelHovered
            ? "bg-red-950/90 ring-red-500/40 text-red-200 scale-105 shadow-[0_24px_50px_-12px_rgba(239,68,68,0.35)]"
            : isLimitWarning
              ? "bg-amber-950/90 ring-amber-500/40 text-amber-100 shadow-[0_24px_50px_-12px_rgba(245,158,11,0.25)]"
              : "bg-card/90 dark:bg-card/95 ring-border/40 text-foreground shadow-[0_24px_50px_-12px_rgba(0,0,0,0.35)]"
        }`}
      >
        {isCancelHovered ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-red-500/20 text-red-300 shadow-inner">
              <RotateCcw className="size-8 animate-spin" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-base font-semibold tracking-wide text-red-200">
                {t("chat_input.voice_release_to_cancel")}
              </span>
              <span className="text-xs text-red-300/70">
                松手后将放弃本次录音
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* 对称多频段动态声浪（无内外边框冲突） */}
            <div className="flex h-11 items-center justify-center gap-1 px-2">
              {WAVE_BAR_SCALES.map((scale, i) => {
                const height = Math.max(6, Math.min(38, 8 + amplitude * 28 * scale));
                return (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-all duration-75 ${
                      isLimitWarning
                        ? "bg-gradient-to-t from-amber-500 to-amber-300"
                        : "bg-gradient-to-t from-primary/70 via-primary to-primary"
                    }`}
                    style={{ height: `${height}px` }}
                  />
                );
              })}
            </div>

            {/* 计时器与录音中红点 */}
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                    isLimitWarning ? "bg-amber-400" : "bg-red-400"
                  }`}
                />
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    isLimitWarning ? "bg-amber-500" : "bg-red-500"
                  }`}
                />
              </span>
              <span className="font-mono text-sm font-semibold tracking-wider">
                {formatVoiceDuration(holdDurationMs)}
              </span>
              <span className="font-mono text-xs opacity-50">/ 03:00</span>
            </div>

            {/* 一体化手势指示与进度（彻底移除内层边框） */}
            <div className="flex w-full flex-col items-center gap-2 pt-0.5">
              <div
                className={`flex items-center gap-1.5 transition-all duration-150 ${
                  progress > 0
                    ? "font-medium text-amber-400"
                    : "text-muted-foreground/80"
                }`}
                style={{ transform: `translateY(-${progress * 4}px)` }}
              >
                <ArrowUp
                  className={`size-3.5 transition-transform duration-150 ${
                    progress > 0 ? "animate-bounce text-amber-400" : "opacity-60"
                  }`}
                />
                <span className="text-xs">
                  {t("chat_input.voice_slide_up_cancel")}
                </span>
              </div>

              {/* 极简无框进度指示槽 */}
              <div className="h-1 w-28 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-rose-500 to-red-500 transition-[width] duration-75"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>

              <span
                className={`text-[11px] transition-colors ${
                  isLimitWarning ? "font-medium text-amber-300" : "text-muted-foreground/60"
                }`}
              >
                {isLimitWarning
                  ? t("chat_input.voice_limit_warning")
                  : t("chat_input.voice_release_to_send")}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
