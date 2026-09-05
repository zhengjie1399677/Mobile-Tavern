import React, { useMemo } from "react";
import { Compass, Zap } from "lucide-react";
import { useActivityMetrics } from "./useActivityMetrics";

interface ActivityRingsOrbitWidgetProps {
  className?: string;
}

export const ActivityRingsOrbitWidget: React.FC<ActivityRingsOrbitWidgetProps> = ({
  className = "",
}) => {
  const { todayCount, todaySessionCount, hourlyDistribution } = useActivityMetrics();

  // 外环：当前已载入数据中的今日活跃量（以 30 次交互为满环基准）
  const outerProgress = Math.min(1, Math.max(0.04, todayCount / 30));
  // 内环：多会话深度（以 3 个活跃会话为满环基准）
  const innerProgress = Math.min(1, Math.max(0.04, todaySessionCount / 3));

  // SVG 环参数
  const outerRadius = 58;
  const outerCircumference = 2 * Math.PI * outerRadius;
  const outerOffset = outerCircumference * (1 - outerProgress);

  const innerRadius = 44;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const innerOffset = innerCircumference * (1 - innerProgress);

  // 24小时热力环：找到最大小时数
  const maxHourCount = useMemo(() => {
    let max = 1;
    for (const c of hourlyDistribution) {
      if (c > max) max = c;
    }
    return max;
  }, [hourlyDistribution]);

  // 生成 24 个时段的光弧刻度
  const clockSectors = useMemo(() => {
    return hourlyDistribution.map((count, hour) => {
      const angle = (hour / 24) * 360 - 90;
      const intensity = count > 0 ? Math.min(1, count / maxHourCount) : 0;
      return {
        hour,
        angle,
        intensity,
      };
    });
  }, [hourlyDistribution, maxHourCount]);

  return (
    <div
      data-ui="activity-rings-orbit-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

      {/* 头部标题与图例 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Compass className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">宿主活跃脉搏</h3>
            <p className="text-[10px] text-muted-foreground">时空流光罗盘</p>
          </div>
        </div>

        {/* 纯图形化双色图例 */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 font-mono text-cyan-400">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
            已载入交互
          </span>
          <span className="flex items-center gap-1 font-mono text-purple-400">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_6px_#c084fc]" />
            已载入会话
          </span>
        </div>
      </div>

      {/* 核心双重视效：左侧双重流光圆环，右侧 24 小时昼夜时相盘 */}
      <div className="grid grid-cols-2 items-center gap-2 py-2">
        {/* 1. 双重活跃发光环 (Activity Rings) */}
        <div className="relative flex flex-col items-center justify-center">
          <svg className="h-34 w-34 -rotate-90 transform" viewBox="0 0 140 140">
            <defs>
              <linearGradient id="orbit-outer-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
              <linearGradient id="orbit-inner-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>

            {/* 外环底色与流光 */}
            <circle cx="70" cy="70" r={outerRadius} stroke="currentColor" strokeWidth="7" className="text-white/8" fill="none" />
            <circle
              cx="70"
              cy="70"
              r={outerRadius}
              stroke="url(#orbit-outer-grad)"
              strokeWidth="7"
              strokeDasharray={outerCircumference}
              strokeDashoffset={outerOffset}
              strokeLinecap="round"
              fill="none"
              className="transition-[stroke-dashoffset] duration-700 ease-out"
              style={{ filter: "drop-shadow(0 0 6px rgba(6, 182, 212, 0.6))" }}
            />

            {/* 内环底色与流光 */}
            <circle cx="70" cy="70" r={innerRadius} stroke="currentColor" strokeWidth="7" className="text-white/8" fill="none" />
            <circle
              cx="70"
              cy="70"
              r={innerRadius}
              stroke="url(#orbit-inner-grad)"
              strokeWidth="7"
              strokeDasharray={innerCircumference}
              strokeDashoffset={innerOffset}
              strokeLinecap="round"
              fill="none"
              className="transition-[stroke-dashoffset] duration-700 ease-out"
              style={{ filter: "drop-shadow(0 0 6px rgba(168, 85, 247, 0.6))" }}
            />
          </svg>

          {/* 表盘中心微光脉冲 */}
          <div className="absolute flex flex-col items-center justify-center">
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-cyan-400/20 to-purple-400/20 flex items-center justify-center backdrop-blur-md border border-white/20 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              <Zap className="h-3.5 w-3.5 text-cyan-300 animate-pulse" />
            </div>
          </div>
        </div>

        {/* 2. 24 小时昼夜时相盘 (Diurnal Sector Wheel) */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative flex items-center justify-center">
            <svg className="h-32 w-32" viewBox="0 0 120 120">
              {/* 中心底圆 */}
              <circle cx="60" cy="60" r="48" stroke="currentColor" strokeWidth="1" className="text-white/10" fill="none" />
              <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1" className="text-white/5" fill="none" />

              {/* 24 个时段放射刻度条 */}
              {clockSectors.map((sector) => {
                const rad = (sector.angle * Math.PI) / 180;
                const innerR = 34;
                const outerR = 34 + (sector.intensity > 0 ? 6 + sector.intensity * 12 : 2);
                const x1 = 60 + innerR * Math.cos(rad);
                const y1 = 60 + innerR * Math.sin(rad);
                const x2 = 60 + outerR * Math.cos(rad);
                const y2 = 60 + outerR * Math.sin(rad);

                let strokeColor = "rgba(255, 255, 255, 0.12)";
                let filter = undefined;
                if (sector.intensity > 0) {
                  strokeColor =
                    sector.intensity > 0.6
                      ? "rgba(168, 85, 247, 0.95)"
                      : "rgba(6, 182, 212, 0.85)";
                  filter = "drop-shadow(0 0 4px rgba(6, 182, 212, 0.7))";
                }

                return (
                  <line
                    key={sector.hour}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={strokeColor}
                    strokeWidth={sector.intensity > 0 ? 3 : 1.5}
                    strokeLinecap="round"
                    style={{ filter }}
                  />
                );
              })}
            </svg>

            {/* 极简象限坐标标尺 (0h / 6h / 12h / 18h) */}
            <span className="absolute top-0 text-[8px] font-mono text-muted-foreground/60">00</span>
            <span className="absolute right-1 text-[8px] font-mono text-muted-foreground/60">06</span>
            <span className="absolute bottom-0 text-[8px] font-mono text-muted-foreground/60">12</span>
            <span className="absolute left-1 text-[8px] font-mono text-muted-foreground/60">18</span>
          </div>

          <span className="text-[9px] font-mono text-muted-foreground/70 mt-1">
            24H 昼夜分布
          </span>
        </div>
      </div>
    </div>
  );
};

export default ActivityRingsOrbitWidget;
