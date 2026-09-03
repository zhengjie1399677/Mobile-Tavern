import React, { useMemo } from "react";
import { Activity } from "lucide-react";
import { useActivityMetrics } from "./useActivityMetrics";

interface TrendSparklineWaveWidgetProps {
  className?: string;
}

export const TrendSparklineWaveWidget: React.FC<TrendSparklineWaveWidgetProps> = ({
  className = "",
}) => {
  const { last7Days } = useActivityMetrics();

  // 计算波形图点坐标
  const { pathD, areaD, points, maxVal } = useMemo(() => {
    let max = 1;
    for (const d of last7Days) {
      if (d.count > max) max = d.count;
    }

    const width = 280;
    const height = 70;
    const paddingX = 16;
    const paddingTop = 12;
    const paddingBottom = 16;
    const innerHeight = height - paddingTop - paddingBottom;
    const step = (width - paddingX * 2) / (last7Days.length - 1);

    const pts = last7Days.map((d, i) => {
      const x = paddingX + i * step;
      const normalized = d.count / max;
      const y = paddingTop + innerHeight * (1 - normalized);
      return { x, y, count: d.count, label: d.dayLabel };
    });

    if (pts.length < 2) {
      return { pathD: "", areaD: "", points: pts, maxVal: max };
    }

    // 生成平滑贝塞尔曲线路径
    let pD = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cp1x = p0.x + (p1.x - p0.x) / 2;
      const cp1y = p0.y;
      const cp2x = p0.x + (p1.x - p0.x) / 2;
      const cp2y = p1.y;
      pD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }

    // 生成面积闭合路径
    const aD = `${pD} L ${pts[pts.length - 1].x} ${height} L ${pts[0].x} ${height} Z`;

    return { pathD: pD, areaD: aD, points: pts, maxVal: max };
  }, [last7Days]);

  return (
    <div
      data-ui="trend-sparkline-wave-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent" />

      {/* 头部标题与图例 */}
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">7日活跃脉冲波形</h3>
            <p className="text-[10px] text-muted-foreground">趋势起伏图</p>
          </div>
        </div>

        <div className="flex items-center gap-1 font-mono text-[10px] text-cyan-400/90">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          近一周流动
        </div>
      </div>

      {/* 核心 SVG 平滑渐变波形图 */}
      <div className="relative mt-2 flex flex-col items-center">
        <svg
          viewBox="0 0 280 75"
          className="h-20 w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            {/* 面积流光渐变 */}
            <linearGradient id="wave-area-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#8b5cf6" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </linearGradient>
            {/* 顶部线条发光渐变 */}
            <linearGradient id="wave-stroke-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
          </defs>

          {/* 水平轻量基准辅助虚线 */}
          <line
            x1="12"
            y1="40"
            x2="268"
            y2="40"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeDasharray="3 3"
            className="text-white/8"
          />

          {/* 渐变波形填充面积 */}
          {areaD && <path d={areaD} fill="url(#wave-area-grad)" />}

          {/* 渐变流光曲线描边 */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="url(#wave-stroke-grad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 6px rgba(129, 140, 248, 0.6))" }}
            />
          )}

          {/* 数据点微光光斑 */}
          {points.map((pt, i) => {
            if (pt.count <= 0) return null;
            return (
              <g key={i}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="3.5"
                  fill="#ffffff"
                  stroke="#06b6d4"
                  strokeWidth="2"
                  style={{ filter: "drop-shadow(0 0 4px #38bdf8)" }}
                />
              </g>
            );
          })}
        </svg>

        {/* 底部 7 日刻度对齐 */}
        <div className="flex w-full justify-between px-3 text-center text-[10px] font-mono text-muted-foreground/80 mt-1">
          {points.map((pt, i) => (
            <span
              key={i}
              className={pt.count > 0 ? "text-cyan-300 font-bold" : "text-muted-foreground/60"}
            >
              {pt.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TrendSparklineWaveWidget;
