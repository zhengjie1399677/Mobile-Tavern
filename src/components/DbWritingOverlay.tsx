import { useCallback, useEffect, useState } from "react";
import { useUnifiedApp } from "../UnifiedAppContext";
import { useTranslation } from "../contexts/LanguageContext";
import { Button } from "../../components/ui/button";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";

/**
 * 写入遮罩的逃生超时。
 *
 * 该遮罩位于主布局内、覆盖整个视口（含底栏）并吞掉所有点击；一旦某次
 * IndexedDB 写入的 await 长时间不返回，界面就会永久停在"整屏变暗 + 点不动"，
 * 只能杀进程。这里到点后提供一个显式关闭入口（同一时间起效的还有 Android 返回键），
 * 让用户至少能把 App 用回来；写入本身不受影响，仍会照常提交。
 */
const WRITE_OVERLAY_ESCAPE_MS = 10_000;

/** 逃生入口优先级高于弹窗返回栈（1000）与页面级返回，仅低于全屏插件。 */
const WRITE_OVERLAY_BACK_PRIORITY = 1500;

export default function DbWritingOverlay() {
  const { t } = useTranslation();
  const { isDbWriting } = useUnifiedApp((state) => ({ isDbWriting: state.isDbWriting }));
  // escapeReady：本次写入已经超时，可以给出逃生入口。
  // released：用户已经解除遮挡；在本次写入结束前不再重新遮挡（宁可少挡一次，
  // 也不要让"卡住的写入"把界面永久锁死）。
  const [escapeReady, setEscapeReady] = useState(false);
  const [released, setReleased] = useState(false);

  useEffect(() => {
    if (!isDbWriting) {
      setEscapeReady(false);
      setReleased(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setEscapeReady(true);
      // 到点先落一条日志：即使用户随后直接杀进程，logcat/JS 日志里也能看到
      // "遮罩超过 10s 未结束"这一现场，便于定位卡住的写入。
      console.warn(
        `[DbWritingOverlay] 写入遮罩已持续超过 ${WRITE_OVERLAY_ESCAPE_MS}ms，等待用户释放遮挡。`,
      );
    }, WRITE_OVERLAY_ESCAPE_MS);
    return () => window.clearTimeout(timer);
  }, [isDbWriting]);

  const releaseOverlay = useCallback(() => {
    console.warn(
      `[DbWritingOverlay] 写入遮罩超过 ${WRITE_OVERLAY_ESCAPE_MS}ms 仍未结束，已按用户操作释放遮挡。`,
    );
    setEscapeReady(false);
    setReleased(true);
  }, []);

  useMobileBackHandler(
    isDbWriting && !released,
    () => {
      releaseOverlay();
      return true;
    },
    WRITE_OVERLAY_BACK_PRIORITY,
  );

  if (!isDbWriting || released) return null;

  return (
    // 刻意不用 backdrop-blur：部分 Android WebView 在动画中给大面积 backdrop-filter
    // 做合成时会整块渲染成不透明黑（现场表现是"整屏纯黑、文字全看不见"），
    // 而这层恰恰是故障时唯一还能看到的东西。半透明底色已足够表达"写入中"。
    <div className="absolute inset-0 bg-black/60 z-50 flex flex-col items-center justify-center animate-fadeIn">
      <div className="bg-card border border-border p-5 rounded-2xl flex flex-col items-center gap-3 shadow-2xl max-w-[200px] text-center">
        <div className="w-8 h-8 border-2 border-[var(--accent-color)]/30 border-t-[var(--accent-color)] rounded-full animate-spin" />
        <div className="space-y-1">
          <p className="text-xs font-bold text-foreground">
            {t("db.writing_overlay")}
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            IndexedDB Transactions
          </p>
        </div>
        {escapeReady && (
          <div className="space-y-2">
            <p className="text-[10px] leading-relaxed text-amber-400">
              {t("db.writing_overlay_timeout")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-3 text-[11px]"
              onClick={releaseOverlay}
            >
              {t("common.close")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
