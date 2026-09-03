import React, { useRef, useState, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { useActivityMetrics, getMoodColor } from "./useActivityMetrics";

interface RussellMoodCompassWidgetProps {
  className?: string;
}

export const RussellMoodCompassWidget: React.FC<RussellMoodCompassWidgetProps> = ({
  className = "",
}) => {
  const { todayMood, saveMood } = useActivityMetrics();
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 默认中心或已记录位置
  const currentX = todayMood?.x ?? 0.3;
  const currentY = todayMood?.y ?? 0.4;

  const moodStyle = getMoodColor(currentX, currentY);

  const handlePointerUpdate = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width / 2;

      let dx = (clientX - centerX) / radius;
      let dy = -(clientY - centerY) / radius; // SVG Y轴向下，因此取负

      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 1) {
        dx /= distance;
        dy /= distance;
      }

      saveMood({ x: dx, y: dy });
    },
    [saveMood]
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    handlePointerUpdate(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDragging) {
      handlePointerUpdate(e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  // 映射星核在 SVG (viewBox 0 0 160 160) 上的像素坐标
  const cx = 80 + currentX * 68;
  const cy = 80 - currentY * 68;

  return (
    <div
      data-ui="russell-mood-compass-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[1px] transition-colors duration-500"
        style={{
          background: `linear-gradient(90deg, transparent, ${moodStyle.primary}, transparent)`,
        }}
      />

      {/* 头部标题与当前定锚心相 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-500"
            style={{
              backgroundColor: `${moodStyle.primary}20`,
              color: moodStyle.primary,
            }}
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">心智气象罗盘</h3>
            <p className="text-[10px] text-muted-foreground">极坐标双轴心相定锚</p>
          </div>
        </div>

        {/* 当前状态徽章 */}
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition-all duration-500 border"
          style={{
            borderColor: `${moodStyle.primary}40`,
            backgroundColor: `${moodStyle.primary}15`,
            color: moodStyle.primary,
            boxShadow: `0 0 12px ${moodStyle.glow}`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full animate-ping"
            style={{ backgroundColor: moodStyle.primary }}
          />
          <span>{moodStyle.label}</span>
        </div>
      </div>

      {/* 核心极坐标雷达与四象限图例 */}
      <div className="flex flex-col sm:flex-row items-center justify-around gap-3 pt-1">
        {/* 交互式极坐标 SVG 雷达 */}
        <div className="relative touch-none select-none cursor-crosshair">
          <svg
            ref={svgRef}
            viewBox="0 0 160 160"
            className="h-38 w-38 overflow-visible"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              {/* 四象限背景微光晕 */}
              <radialGradient id="compass-bg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.03)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>

            {/* 底盘背景 */}
            <circle cx="80" cy="80" r="70" fill="url(#compass-bg)" />

            {/* 同心圆雷达刻度 */}
            <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="1" className="text-white/10" fill="none" />
            <circle cx="80" cy="80" r="46" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3" className="text-white/8" fill="none" />
            <circle cx="80" cy="80" r="23" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3" className="text-white/8" fill="none" />

            {/* 十字十字坐标轴 */}
            <line x1="10" y1="80" x2="150" y2="80" stroke="currentColor" strokeWidth="1" className="text-white/15" />
            <line x1="80" y1="10" x2="80" y2="150" stroke="currentColor" strokeWidth="1" className="text-white/15" />

            {/* 轴向标签 */}
            <text x="80" y="8" textAnchor="middle" className="fill-muted-foreground/60 text-[8px] font-mono select-none">充沛</text>
            <text x="80" y="158" textAnchor="middle" className="fill-muted-foreground/60 text-[8px] font-mono select-none">疲惫</text>
            <text x="6" y="83" textAnchor="middle" className="fill-muted-foreground/60 text-[8px] font-mono select-none">负向</text>
            <text x="154" y="83" textAnchor="middle" className="fill-muted-foreground/60 text-[8px] font-mono select-none">正向</text>

            {/* 中心锚点微十字 */}
            <circle cx="80" cy="80" r="1.5" fill="rgba(255,255,255,0.3)" />

            {/* 发光星核 (Luminous Star Core) */}
            <circle
              cx={cx}
              cy={cy}
              r="14"
              fill={moodStyle.primary}
              opacity="0.25"
              className="animate-pulse"
              style={{ filter: `drop-shadow(0 0 8px ${moodStyle.glow})` }}
            />
            <circle
              cx={cx}
              cy={cy}
              r="6.5"
              fill={moodStyle.primary}
              stroke="#ffffff"
              strokeWidth="2"
              className="transition-[cx,cy] duration-75"
              style={{ filter: `drop-shadow(0 0 6px ${moodStyle.primary})` }}
            />
          </svg>
        </div>

        {/* 象限微光图例与提示 */}
        <div className="flex flex-col gap-1.5 text-[10px]">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_4px_#f59e0b]" />
              <span>充沛 · 灵感</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
              <span>宁静 · 自洽</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-purple-300">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_4px_#a855f7]" />
              <span>紧绷 · 焦灼</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-indigo-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_4px_#6366f1]" />
              <span>疲惫 · 虚耗</span>
            </div>
          </div>

          <p className="mt-1 text-[9px] text-muted-foreground/70 text-center sm:text-left">
            轻触罗盘拖动星核 · 实时染色日历色谱
          </p>
        </div>
      </div>
    </div>
  );
};

export default RussellMoodCompassWidget;
