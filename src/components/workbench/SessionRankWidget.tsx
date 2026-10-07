import React, { useMemo, useState } from "react";
import { BarChart3, Trophy } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";

interface SessionRankWidgetProps {
  className?: string;
}

type RankMetric = "turns" | "chars";

const METRIC_LABEL: Record<RankMetric, string> = {
  turns: "轮次",
  chars: "字数",
};

function formatValue(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/**
 * 会话活跃排行：按轮次或字数给出 Top 5 横向条形图。
 * 数据来自会话目录元数据（turnCount / charCount / updatedAt），不依赖消息是否已分页加载。
 */
export const SessionRankWidget: React.FC<SessionRankWidgetProps> = ({ className = "" }) => {
  const { sessions, characters } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    characters: state.characters,
  }));
  const [metric, setMetric] = useState<RankMetric>("turns");

  const rows = useMemo(() => {
    const avatarById = new Map(characters.map((character) => [character.id, character]));
    return sessions
      .map((session) => {
        const character = avatarById.get(session.characterId);
        const value = metric === "turns"
          ? (typeof session.turnCount === "number" ? session.turnCount : 0)
          : (typeof session.charCount === "number" ? session.charCount : 0);
        return {
          id: session.id,
          value,
          title: session.title || character?.name || "未命名会话",
          characterName: character?.name ?? "已移除角色",
          avatar: character?.avatar ?? "",
          archived: session.lifecycle === "archived",
          updatedAt: session.updatedAt ?? session.createdAt ?? 0,
        };
      })
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value || right.updatedAt - left.updatedAt)
      .slice(0, 5);
  }, [sessions, characters, metric]);

  const maxValue = rows[0]?.value ?? 1;

  return (
    <div
      data-ui="session-rank-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <Trophy className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">会话活跃排行</h3>
            <p className="text-[10px] text-muted-foreground">按会话目录元数据统计 Top 5</p>
          </div>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-[10px]">
          {(["turns", "chars"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMetric(option)}
              aria-pressed={metric === option}
              className={`rounded-md px-2 py-0.5 font-medium transition-all ${
                metric === option ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {METRIC_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-muted-foreground/70">
          暂无带统计数据的会话
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id} className="space-y-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground/70">#{index + 1}</span>
                {row.avatar ? (
                  <img src={row.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[8px] text-muted-foreground">
                    {row.characterName.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.title}</span>
                {row.archived && (
                  <span className="shrink-0 rounded bg-white/10 px-1 py-0.2 text-[8px] text-muted-foreground">已归档</span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-amber-300/90">{formatValue(row.value)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-rose-400/70"
                  style={{ width: `${Math.max(6, Math.round((row.value / maxValue) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-2 flex items-center gap-1 font-mono text-[9px] text-muted-foreground/70">
        <BarChart3 className="h-3 w-3" />
        共 {sessions.length} 个会话参与排名
      </div>
    </div>
  );
};
