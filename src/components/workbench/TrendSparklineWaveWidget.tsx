import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { useActivityMetrics } from "./useActivityMetrics";

interface TrendSparklineWaveWidgetProps {
  className?: string;
}

/**
 * SVG 坐标与渲染尺寸 1:1：
 * viewBox 宽度取容器实宽、高度固定 80（= CSS h-20），
 * 因此不需要 `preserveAspectRatio="none"`，数据点不会被拉伸成椭圆。
 */
const VIEW_HEIGHT = 80;
const PADDING_X = 16;
const PADDING_TOP = 12;
/** 底部留白同时充当刻度文字带：刻度画在同一坐标系内，不再靠外层 flex 对齐。 */
const PADDING_BOTTOM = 16;
/** 容器宽度尚未测量到时（首帧 / 无 ResizeObserver 的环境）使用的兜底宽度。 */
const FALLBACK_WIDTH = 320;

export const TrendSparklineWaveWidget = React.memo(function TrendSparklineWaveWidget({
  className = "",
}: TrendSparklineWaveWidgetProps) {
  const { last7Days } = useActivityMetrics();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  // 按容器实宽取坐标：曲线、数据点、面积与刻度文字共用同一坐标系。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { pathD, areaD, points, baseline } = useMemo(() => {
    let max = 1;
    for (const d of last7Days) {
      if (d.count > max) max = d.count;
    }

    const innerHeight = VIEW_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
    // 面积基线 = 绘图区底部（此前误用绘图高度 70，比 viewBox 高 75 少 5，填充会悬空）。
    const baselineY = PADDING_TOP + innerHeight;
    const usableWidth = Math.max(width - PADDING_X * 2, 1);
    const step = last7Days.length > 1 ? usableWidth / (last7Days.length - 1) : 0;

    const pts = last7Days.map((d, i) => {
      const x = PADDING_X + i * step;
      const normalized = Math.min(1, Math.max(0, d.count / max));
      const y = PADDING_TOP + innerHeight * (1 - normalized);
      return { x, y, count: d.count, label: d.dayLabel };
    });

    if (pts.length < 2) {
      return { pathD: "", areaD: "", points: pts, baseline: baselineY };
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
    const aD = `${pD} L ${pts[pts.length - 1].x} ${baselineY} L ${pts[0].x} ${baselineY} Z`;

    return { pathD: pD, areaD: aD, points: pts, baseline: baselineY };
  }, [last7Days, width]);

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
      <div ref={containerRef} className="relative mt-2">
        <svg
          viewBox={`0 0 ${width} ${VIEW_HEIGHT}`}
          className="h-20 w-full overflow-visible"
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

          {/* 水平基准辅助虚线：与面积基线、数据点同一条横线 */}
          {points.length >= 2 && (
            <line
              x1={points[0].x}
              y1={baseline}
              x2={points[points.length - 1].x}
              y2={baseline}
              stroke="currentColor"
              strokeWidth="0.8"
              strokeDasharray="3 3"
              className="text-white/8"
            />
          )}

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

          {/* 数据点微光光斑（等比坐标系下为正圆） */}
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

          {/* 底部 7 日刻度：与数据点同坐标系，x 严格对齐 */}
          {points.map((pt, i) => (
            <text
              key={i}
              x={pt.x}
              y={VIEW_HEIGHT - 3}
              textAnchor="middle"
              className={`text-[10px] font-mono ${
                pt.count > 0 ? "fill-cyan-300 font-bold" : "fill-muted-foreground/60"
              }`}
            >
              {pt.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
});

export default TrendSparklineWaveWidget;
