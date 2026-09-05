import React, { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Flame } from "lucide-react";
import { useActivityMetrics, getMoodColor, type MoodPoint } from "./useActivityMetrics";

interface HostCalendarWidgetProps {
  className?: string;
}

export const HostCalendarWidget: React.FC<HostCalendarWidgetProps> = ({ className = "" }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const { dailyHeatmap, dailyMoods, maxDailyCount } = useActivityMetrics();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月"
  ];
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  // 计算当月日历网格及每个日期的活跃度与心相色彩
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const formatDateKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const days: Array<{
      day: number;
      isCurrentMonth: boolean;
      date: Date;
      isToday: boolean;
      isSelected: boolean;
      activityCount: number;
      activityLevel: 0 | 1 | 2 | 3;
      mood?: MoodPoint;
    }> = [];

    const today = new Date();
    const isSameDate = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    const getActivityLevel = (count: number): 0 | 1 | 2 | 3 => {
      if (count <= 0) return 0;
      if (count <= 5) return 1;
      if (count <= 15) return 2;
      return 3;
    };

    // 上个月的补位天数
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const date = new Date(year, month - 1, d);
      const key = formatDateKey(date);
      const count = dailyHeatmap.get(key) ?? 0;
      days.push({
        day: d,
        isCurrentMonth: false,
        date,
        isToday: false,
        isSelected: false,
        activityCount: count,
        activityLevel: getActivityLevel(count),
        mood: dailyMoods.get(key),
      });
    }

    // 当月天数
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const key = formatDateKey(date);
      const count = dailyHeatmap.get(key) ?? 0;
      days.push({
        day: d,
        isCurrentMonth: true,
        date,
        isToday: isSameDate(date, today),
        isSelected: isSameDate(date, selectedDate),
        activityCount: count,
        activityLevel: getActivityLevel(count),
        mood: dailyMoods.get(key),
      });
    }

    // 下个月的补位天数
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(year, month + 1, d);
      const key = formatDateKey(date);
      const count = dailyHeatmap.get(key) ?? 0;
      days.push({
        day: d,
        isCurrentMonth: false,
        date,
        isToday: false,
        isSelected: false,
        activityCount: count,
        activityLevel: getActivityLevel(count),
        mood: dailyMoods.get(key),
      });
    }

    return days;
  }, [year, month, selectedDate, dailyHeatmap, dailyMoods]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleGoToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDate(now);
  };

  const selectedKey = useMemo(() => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const d = String(selectedDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [selectedDate]);

  const selectedCount = dailyHeatmap.get(selectedKey) ?? 0;
  const selectedMood = dailyMoods.get(selectedKey);
  const selectedMoodStyle = selectedMood ? getMoodColor(selectedMood.x, selectedMood.y) : null;

  return (
    <div
      data-ui="host-calendar-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

      {/* 头部标题与月份切换 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
            <CalendarIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">
              {year} 年 {monthNames[month]}
            </h3>
            <p className="text-[10px] text-muted-foreground">已载入活跃热力与心相色谱</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleGoToday}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-foreground/80 hover:bg-white/10 active:scale-95 transition-all"
          >
            今天
          </button>
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="上个月"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/5 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 active:scale-90 transition-all"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="下个月"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/5 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 active:scale-90 transition-all"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 星期表头 */}
      <div className="mb-1.5 grid grid-cols-7 text-center">
        {weekDays.map((w, idx) => (
          <span
            key={w}
            className={`text-[10px] font-medium ${
              idx === 0 || idx === 6 ? "text-cyan-400/80" : "text-muted-foreground/80"
            }`}
          >
            {w}
          </span>
        ))}
      </div>

      {/* 日期热力网格 */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {calendarGrid.map((item, index) => {
          let cellStyle = "text-muted-foreground/30 hover:bg-white/5";
          let glowDot = null;

          if (item.isCurrentMonth) {
            if (item.isSelected) {
              cellStyle =
                "border border-cyan-400 bg-cyan-500/20 text-cyan-200 font-bold shadow-[0_0_12px_rgba(6,182,212,0.5)]";
            } else if (item.isToday) {
              cellStyle =
                "border border-white/30 bg-white/10 text-foreground font-bold shadow-[0_0_8px_rgba(255,255,255,0.2)]";
            } else {
              cellStyle = "text-foreground/90 hover:bg-white/10";
            }

            // 心相色彩联动 (若当日有心相定锚，优先采用心相发光色)
            if (item.mood) {
              const moodInfo = getMoodColor(item.mood.x, item.mood.y);
              glowDot = (
                <span
                  className="absolute bottom-1 h-1.5 w-1.5 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: moodInfo.primary,
                    boxShadow: `0 0 8px ${moodInfo.glow}`,
                  }}
                  title={moodInfo.label}
                />
              );
            } else if (item.activityLevel === 1) {
              glowDot = (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-cyan-400 shadow-[0_0_4px_#22d3ee]" />
              );
            } else if (item.activityLevel === 2) {
              glowDot = (
                <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-indigo-400 shadow-[0_0_6px_#818cf8]" />
              );
            } else if (item.activityLevel === 3) {
              glowDot = (
                <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-gradient-to-tr from-cyan-400 to-purple-400 shadow-[0_0_8px_#c084fc] animate-pulse" />
              );
            }
          }

          return (
            <button
              key={`${item.date.toISOString()}-${index}`}
              type="button"
              disabled={!item.isCurrentMonth}
              onClick={() => {
                if (item.isCurrentMonth) {
                  setSelectedDate(item.date);
                }
              }}
              className={`relative flex h-8 w-full flex-col items-center justify-center rounded-lg text-xs transition-all active:scale-95 ${cellStyle}`}
            >
              <span className={glowDot ? "-translate-y-0.5" : ""}>{item.day}</span>
              {glowDot}
            </button>
          );
        })}
      </div>

      {/* 底部热力与心相图例标尺 */}
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Flame className="h-3 w-3 text-cyan-400" />
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" title="无活跃" />
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_4px_#22d3ee]" title="轻度" />
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b]" title="心相·充沛" />
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" title="心相·宁静" />
          </div>
        </div>

        {/* 选中项的状态量感 */}
        <div className="flex items-center gap-2 font-mono">
          <span className="text-[10px] text-muted-foreground/80">
            {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日
          </span>
          {selectedMoodStyle ? (
            <span
              className="rounded-full px-1.5 py-0.2 text-[9px] font-bold border"
              style={{
                borderColor: `${selectedMoodStyle.primary}40`,
                backgroundColor: `${selectedMoodStyle.primary}20`,
                color: selectedMoodStyle.primary,
              }}
            >
              {selectedMoodStyle.label}
            </span>
          ) : (
            <div className="flex h-2 w-14 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(selectedCount > 0 ? 15 : 0, (selectedCount / Math.max(maxDailyCount, 1)) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HostCalendarWidget;
