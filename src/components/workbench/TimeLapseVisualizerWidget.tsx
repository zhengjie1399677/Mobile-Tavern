import React, { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, RotateCcw, Sparkles } from "lucide-react";

interface TimeLapseVisualizerWidgetProps {
  className?: string;
}

const STORAGE_KEY = "mobile_tavern_workbench_total_wait_seconds";

export const TimeLapseVisualizerWidget: React.FC<TimeLapseVisualizerWidgetProps> = ({
  className = "",
}) => {
  // 预设时长（秒）：5分钟、15分钟、25分钟、45分钟
  const PRESET_DURATIONS = [
    { label: "5分", seconds: 5 * 60 },
    { label: "15分", seconds: 15 * 60 },
    { label: "25分", seconds: 25 * 60 },
    { label: "45分", seconds: 45 * 60 },
  ];

  const [targetSeconds, setTargetSeconds] = useState(25 * 60);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);

  // 持久化统计：累计流逝与等待秒数
  const [totalWaitSeconds, setTotalWaitSeconds] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });

  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = window.setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            return 0;
          }
          return prev - 1;
        });
        setTotalWaitSeconds((prevTotal) => {
          const next = prevTotal + 1;
          try {
            localStorage.setItem(STORAGE_KEY, next.toString());
          } catch {
            // ignore
          }
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning]);

  const handleToggle = () => {
    if (remainingSeconds === 0) {
      setRemainingSeconds(targetSeconds);
      setIsRunning(true);
    } else {
      setIsRunning((prev) => !prev);
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setRemainingSeconds(targetSeconds);
  };

  const handleSelectPreset = (sec: number) => {
    setIsRunning(false);
    setTargetSeconds(sec);
    setRemainingSeconds(sec);
  };

  // 格式化时间
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // 格式化总累计时长
  const formatTotalTime = (secs: number) => {
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (hours > 0) return `${hours}小时${mins}分`;
    return `${mins}分钟`;
  };

  // 计算圆环进度
  const progress = useMemo(() => {
    if (targetSeconds <= 0) return 0;
    return (targetSeconds - remainingSeconds) / targetSeconds;
  }, [targetSeconds, remainingSeconds]);

  // SVG 圆环参数
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <div
      data-ui="timelapse-visualizer-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

      {/* 头部标题与累计记录 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">时空流逝与等待</h3>
            <p className="text-[10px] text-muted-foreground">沉浸等待可视化器</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <span>累计流逝：</span>
          <span className="font-mono font-bold text-cyan-400">{formatTotalTime(totalWaitSeconds)}</span>
        </div>
      </div>

      {/* 预设切换按钮组 */}
      <div className="mb-4 flex items-center justify-center gap-1.5">
        {PRESET_DURATIONS.map((preset) => {
          const isSelected = targetSeconds === preset.seconds;
          return (
            <button
              key={preset.seconds}
              type="button"
              onClick={() => handleSelectPreset(preset.seconds)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-95 ${
                isSelected
                  ? "border border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.25)]"
                  : "border border-white/5 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 中间核心：环形流光进度表盘与粒子动效 */}
      <div className="relative my-2 flex flex-col items-center justify-center">
        {/* 背景柔光晕 */}
        <div
          className={`absolute h-36 w-36 rounded-full bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 blur-2xl transition-opacity duration-1000 ${
            isRunning ? "opacity-100 animate-pulse" : "opacity-40"
          }`}
        />

        <div className="relative flex items-center justify-center">
          <svg className="h-38 w-38 -rotate-90 transform" viewBox="0 0 160 160">
            {/* 底环 */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="currentColor"
              strokeWidth="6"
              className="text-white/10"
              fill="transparent"
            />
            {/* 动态流光发光进度环 */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="url(#timelapse-gradient)"
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-[stroke-dashoffset] duration-500 ease-linear"
              style={{
                filter: isRunning ? "drop-shadow(0 0 8px rgba(6, 182, 212, 0.7))" : "none",
              }}
            />
            <defs>
              <linearGradient id="timelapse-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
          </svg>

          {/* 表盘中心读数与动态沙漏流光 */}
          <div className="absolute flex flex-col items-center justify-center text-center">
            <span className="font-mono text-2xl font-black tracking-tight text-foreground drop-shadow-sm">
              {formatTime(remainingSeconds)}
            </span>
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground/80 mt-0.5">
              {isRunning ? "流逝中..." : remainingSeconds === 0 ? "已完成" : "等待开启"}
            </span>
          </div>
        </div>

        {/* 底部控制按键 */}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={isRunning ? "暂停计时" : "开始计时"}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90 shadow-lg ${
              isRunning
                ? "border border-amber-400/40 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:bg-amber-500/30"
                : "border border-cyan-400/50 bg-gradient-to-tr from-cyan-500 to-purple-600 text-white shadow-[0_0_16px_rgba(6,182,212,0.4)] hover:brightness-110"
            }`}
          >
            {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
          </button>

          <button
            type="button"
            onClick={handleReset}
            aria-label="重置计时"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground active:scale-90"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimeLapseVisualizerWidget;
