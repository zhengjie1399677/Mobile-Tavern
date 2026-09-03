import React, { useState, useEffect } from "react";
import { HostCalendarWidget } from "../components/workbench/HostCalendarWidget";
import { ActivityRingsOrbitWidget } from "../components/workbench/ActivityRingsOrbitWidget";
import { TrendSparklineWaveWidget } from "../components/workbench/TrendSparklineWaveWidget";
import { HostStorageMetricsWidget } from "../components/workbench/HostStorageMetricsWidget";
import { ToolCapabilitiesWidget } from "../components/workbench/ToolCapabilitiesWidget";

export default function WorkbenchTab(): React.JSX.Element {
  const [timeString, setTimeString] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const interval = window.setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      data-ui="workbench-tab"
      className="relative flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-background pb-20 pt-2 px-3 text-foreground"
    >
      {/* 🌟 真实毛玻璃底层：环境光晕与点阵画布 (Ambient Mesh Glow Orbs) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* 右上方幽紫环境光团 */}
        <div className="absolute -top-12 -right-12 h-72 w-72 rounded-full bg-purple-600/18 blur-[90px] animate-pulse" />
        {/* 左下方青蓝环境光团 */}
        <div
          className="absolute top-96 -left-16 h-80 w-80 rounded-full bg-cyan-500/16 blur-[100px] animate-pulse"
          style={{ animationDuration: "4s" }}
        />
        {/* 底部琥珀/微光光团 */}
        <div className="absolute -bottom-10 right-10 h-64 w-64 rounded-full bg-indigo-500/12 blur-[90px]" />

        {/* 细腻微点阵网格 */}
        <div
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
      </div>

      {/* 顶部系统标题与实时时钟 */}
      <div className="relative z-10 mb-3 flex items-center justify-between px-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-black tracking-tight text-foreground">
              宿主工作台
            </h1>
            <span className="text-[10px] font-mono text-muted-foreground/80 tracking-wider">
              WORKBENCH
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[10px] font-medium text-emerald-400/90 font-mono">
              Host Engine Ready
            </span>
          </div>
        </div>

        {/* 实时数字时钟 */}
        <div className="rounded-xl border border-white/10 bg-card/40 px-3 py-1.5 backdrop-blur-xl shadow-sm text-right">
          <span className="font-mono text-sm font-black tracking-wider text-foreground">
            {timeString || "--:--:--"}
          </span>
          <p className="text-[9px] text-muted-foreground/70 font-mono">LOCAL TIME</p>
        </div>
      </div>

      {/* 纯可视化卡片流 */}
      <div className="relative z-10 space-y-3">
        {/* 1. 时空活跃热力日历 (Calendar Heatmap Matrix) */}
        <HostCalendarWidget />

        {/* 2. 宿主活跃脉搏与昼夜罗盘 (Activity Rings & 24H Diurnal Sector) */}
        <ActivityRingsOrbitWidget />

        {/* 3. 7日活跃流光波形图 (Trend Sparkline Wave) */}
        <TrendSparklineWaveWidget />

        {/* 4. 本地存储与持久化透视 */}
        <HostStorageMetricsWidget />

        {/* 5. 宿主 Tool 插件生态 */}
        <ToolCapabilitiesWidget />
      </div>
    </div>
  );
}
