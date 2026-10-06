import React from "react";
import { useTranslation } from "../../../contexts/LanguageContext";

/**
 * 生成等待计时（首字/首包到达前的秒数）。
 *
 * 目的：等待首字节的这段时间屏幕上没有任何输出，用户无法判断已经等了多久，
 * 主观上会觉得更慢。显示秒数纯粹是感官反馈，不改变请求、超时与提交语义。
 *
 * 性能：计时器只在本组件内部每秒 setState，不带动消息气泡（`MessageBubble` 较重）
 * 与虚拟列表重渲染。`startedAt` 取占位消息的 `timestamp`（生成开始时刻），
 * 因此切换会话、重新挂载后计时依旧连续正确。
 */

function elapsedSeconds(startedAt?: number): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

const GeneratingElapsed: React.FC<{ startedAt?: number }> = React.memo(({ startedAt }) => {
  const { t } = useTranslation();
  const [seconds, setSeconds] = React.useState(() => elapsedSeconds(startedAt));

  React.useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    const timer = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <span
      data-testid="generating-elapsed"
      className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70"
    >
      {t("chat.generating_elapsed", { seconds })}
    </span>
  );
});

GeneratingElapsed.displayName = "GeneratingElapsed";

export default GeneratingElapsed;
