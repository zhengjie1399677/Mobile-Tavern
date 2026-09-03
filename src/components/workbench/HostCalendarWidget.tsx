import React, { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface HostCalendarWidgetProps {
  className?: string;
}

export const HostCalendarWidget: React.FC<HostCalendarWidgetProps> = ({ className = "" }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月"
  ];
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  // 计算当月日历网格
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: Array<{
      day: number;
      isCurrentMonth: boolean;
      date: Date;
      isToday: boolean;
      isSelected: boolean;
    }> = [];

    // 上个月的补位天数
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const date = new Date(year, month - 1, d);
      days.push({
        day: d,
        isCurrentMonth: false,
        date,
        isToday: false,
        isSelected: false,
      });
    }

    const today = new Date();
    const isSameDate = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    // 当月天数
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      days.push({
        day: d,
        isCurrentMonth: true,
        date,
        isToday: isSameDate(date, today),
        isSelected: isSameDate(date, selectedDate),
      });
    }

    // 下个月的补位天数（凑满 35 或 42 格）
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(year, month + 1, d);
      days.push({
        day: d,
        isCurrentMonth: false,
        date,
        isToday: false,
        isSelected: false,
      });
    }

    return days;
  }, [year, month, selectedDate]);

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

  return (
    <div
      data-ui="host-calendar-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* 头部标题与月份切换 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <CalendarIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">
              {year} 年 {monthNames[month]}
            </h3>
            <p className="text-[10px] text-muted-foreground">系统时空日历</p>
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
              idx === 0 || idx === 6 ? "text-primary/70" : "text-muted-foreground/80"
            }`}
          >
            {w}
          </span>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {calendarGrid.map((item, index) => {
          let cellStyle = "text-muted-foreground/30 hover:bg-white/5";
          if (item.isCurrentMonth) {
            if (item.isSelected) {
              cellStyle =
                "bg-primary text-primary-foreground font-bold shadow-[0_0_12px_rgba(139,92,246,0.6)]";
            } else if (item.isToday) {
              cellStyle =
                "border border-cyan-400/50 bg-cyan-500/15 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]";
            } else {
              cellStyle = "text-foreground/90 hover:bg-white/10 hover:text-foreground";
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
              className={`flex h-7.5 w-full items-center justify-center rounded-lg text-xs transition-all active:scale-95 ${cellStyle}`}
            >
              <span>{item.day}</span>
            </button>
          );
        })}
      </div>

      {/* 底部选中日期状态 */}
      <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-muted-foreground">
        <span>
          选中：{selectedDate.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
        </span>
        <span className="flex items-center gap-1 text-cyan-400/90 font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          系统时钟同步
        </span>
      </div>
    </div>
  );
};

export default HostCalendarWidget;
