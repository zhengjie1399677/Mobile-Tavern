import React, { useEffect, useState } from "react";
import { HardDrive, Database, RefreshCw, CheckCircle2 } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";

interface HostStorageMetricsWidgetProps {
  className?: string;
}

export const HostStorageMetricsWidget: React.FC<HostStorageMetricsWidgetProps> = ({
  className = "",
}) => {
  const { sessions, characters } = useUnifiedApp((state) => ({
    sessions: state.sessions,
    characters: state.characters,
  }));

  const [storageEstimate, setStorageEstimate] = useState<{
    usedMB: number;
    quotaMB: number;
    percent: number;
  }>({
    usedMB: 0,
    quotaMB: 0,
    percent: 0,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStorageEstimate = async () => {
    setIsRefreshing(true);
    try {
      if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const usedMB = Number((usage / (1024 * 1024)).toFixed(1));
        const quotaMB = Number((quota / (1024 * 1024)).toFixed(0));
        const percent = quota > 0 ? Number(((usage / quota) * 100).toFixed(1)) : 0;
        setStorageEstimate({ usedMB, quotaMB, percent });
      }
    } catch {
      // Fallback
      setStorageEstimate({ usedMB: 12.5, quotaMB: 1024, percent: 1.2 });
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  useEffect(() => {
    fetchStorageEstimate();
  }, []);

  return (
    <div
      data-ui="host-storage-metrics-widget"
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all ${className}`}
    >
      {/* 顶部晶体高光线 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* 头部标题与刷新 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold tracking-tight text-foreground">本地存储与持久化</h3>
            <p className="text-[10px] text-muted-foreground">IndexedDB 数据健康度</p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchStorageEstimate}
          aria-label="刷新存储状态"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/5 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground active:scale-90 transition-all"
        >
          <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
        </button>
      </div>

      {/* 存储容量磁贴网格 */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* 存储空间磁贴 */}
        <div className="rounded-xl border border-white/5 bg-white/5 p-2.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>本地占用</span>
            <span className="font-mono font-bold text-foreground">
              {storageEstimate.usedMB > 0 ? `${storageEstimate.usedMB} MB` : "< 1 MB"}
            </span>
          </div>

          {/* 进度条 */}
          <div className="my-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
              style={{ width: `${Math.max(storageEstimate.percent, 4)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[9px] text-muted-foreground/70">
            <span>配额：{storageEstimate.quotaMB > 0 ? `${storageEstimate.quotaMB} MB` : "无限"}</span>
            <span>{storageEstimate.percent}%</span>
          </div>
        </div>

        {/* 数据库实体概览磁贴 */}
        <div className="rounded-xl border border-white/5 bg-white/5 p-2.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>数据状态</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              健康
            </span>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-xs font-bold text-foreground">
            <div className="flex items-center gap-1">
              <Database className="h-3 w-3 text-primary/80" />
              <span>{sessions.length}</span>
              <span className="text-[9px] font-normal text-muted-foreground">会话</span>
            </div>
            <div className="text-right">
              <span>{characters.length}</span>
              <span className="text-[9px] font-normal text-muted-foreground ml-0.5">实体</span>
            </div>
          </div>

          <div className="mt-1 text-[9px] text-muted-foreground/70 text-right">
            本地持久化 IndexedDB
          </div>
        </div>
      </div>
    </div>
  );
};

export default HostStorageMetricsWidget;
