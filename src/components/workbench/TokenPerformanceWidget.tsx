import React, { useMemo } from "react";
import { Gauge, Zap } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";

interface TokenPerformanceWidgetProps {
  className?: string;
}

interface MessageSample {
  id: string;
  tokens: number;
  seconds: number;
  speed: number;
}

function formatTokens(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * Token 与生成性能：统计本地已加载消息里助手回复的输出 Token、生成耗时与平均速度。
 * 仅使用消息自身持久化的 tokenCount / generationTime，不额外发请求。
 */
export const TokenPerformanceWidget: React.FC<TokenPerformanceWidgetProps> = ({ className = "" }) => {
  const { sessions } = useUnifiedApp((state) => ({ sessions: state.sessions }));

  const { samples, totalTokens, totalSeconds, averageSpeed } = useMemo(() => {
    const collected: MessageSample[] = [];
    let tokenSum = 0;
    let secondSum = 0;
    let speedSum = 0;
    let speedCount = 0;

    for (const session of sessions) {
      for (const message of session.messages ?? []) {
        if (message.sender !== "assistant") continue;
        const tokens = typeof message.tokenCount === "number" && message.tokenCount > 0 ? message.tokenCount : 0;
        const seconds = typeof message.generationTime === "number" && message.generationTime > 0
          ? message.generationTime
          : 0;
        if (tokens === 0 && seconds === 0) continue;
        const speed = tokens > 0 && seconds > 0 ? tokens / seconds : 0;
        collected.push({ id: message.id, tokens, seconds, speed });
        tokenSum += tokens;
        secondSum += seconds;
        if (speed > 0) {
          speedSum += speed;
          speedCount += 1;
        }
      }
    }

    return {
      samples: collected.slice(-40),
      totalTokens: tokenSum,
      totalSeconds: secondSum,
      averageSpeed: speedCount > 0 ? speedSum / speedCount : 0,
    };
  }, [sessions]);

  const maxTokens = samples.reduce((max, sample) => Math.max(max, sample.tokens), 1);

  return (
    <div
      data-ui="token-performance-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">Token 与生成性能</h3>
            <p className="text-[10px] text-muted-foreground">仅统计已加载到本地的回复</p>
          </div>
        </div>
        <span className="font-mono text-[10px] text-cyan-400/90">{samples.length} 条样本</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/8 bg-black/25 px-2 py-1.5">
          <p className="font-mono text-sm font-bold text-foreground">{formatTokens(totalTokens)}</p>
          <p className="text-[9px] text-muted-foreground">累计输出 Token</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/25 px-2 py-1.5">
          <p className="font-mono text-sm font-bold text-foreground">
            {averageSpeed > 0 ? averageSpeed.toFixed(1) : "--"}
          </p>
          <p className="text-[9px] text-muted-foreground">平均 tok/s</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/25 px-2 py-1.5">
          <p className="font-mono text-sm font-bold text-foreground">{totalSeconds.toFixed(1)}s</p>
          <p className="text-[9px] text-muted-foreground">累计生成耗时</p>
        </div>
      </div>

      {samples.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-muted-foreground/70">
          还没有带用量数据的回复
        </p>
      ) : (
        <div className="flex h-16 items-end gap-[3px]">
          {samples.map((sample) => (
            <div
              key={sample.id}
              title={`${formatTokens(sample.tokens)} tokens · ${sample.seconds.toFixed(1)}s`}
              className="min-w-[3px] flex-1 rounded-t-sm bg-gradient-to-t from-cyan-500/40 to-sky-300/80"
              style={{ height: `${Math.max(6, Math.round((sample.tokens / maxTokens) * 100))}%` }}
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 font-mono text-[9px] text-muted-foreground/70">
        <Zap className="h-3 w-3" />
        最近 {samples.length} 条：越高表示输出 Token 越多
      </div>
    </div>
  );
};
