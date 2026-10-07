import React, { useState, useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import {
  WORKBENCH_CARDS,
  WORKBENCH_CARD_IDS,
} from "../components/workbench/workbenchCards";
import { WorkbenchLayoutDialog } from "../components/workbench/WorkbenchLayoutDialog";
import {
  resolveHiddenWorkbenchCards,
  resolveWorkbenchCardOrder,
} from "../domain/ui/workbenchLayout";
import { useUnifiedApp } from "../UnifiedAppContext";

export default function WorkbenchTab(): React.JSX.Element {
  const { settings, updateSettings } = useUnifiedApp((state) => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
  }));
  const ambientGlowIntensity = settings?.ambientGlowIntensity ?? 0.6;
  const [timeString, setTimeString] = useState("");
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false);

  // 卡片顺序与显示由用户布局决定：未知 id 忽略、新卡片自动补到末尾。
  const cardOrder = resolveWorkbenchCardOrder(WORKBENCH_CARD_IDS, settings?.workbenchCardLayout);
  const hiddenCardIds = resolveHiddenWorkbenchCards(WORKBENCH_CARD_IDS, settings?.workbenchCardLayout);
  const hiddenSet = new Set(hiddenCardIds);
  const visibleCards = cardOrder
    .filter((id) => !hiddenSet.has(id))
    .map((id) => WORKBENCH_CARDS.find((card) => card.id === id))
    .filter((card): card is (typeof WORKBENCH_CARDS)[number] => Boolean(card));

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
      className="relative min-h-full space-y-3.5 px-3 pt-2 pb-14 text-foreground"
    >
      {/* 🌟 真实毛玻璃底层：环境光晕与点阵画布 (Fixed Ambient Mesh Glow Orbs) */}
      {ambientGlowIntensity > 0 && (
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden ambient-glow-layer transition-opacity duration-300"
          style={{ opacity: ambientGlowIntensity }}
          aria-hidden="true"
        >
          {/* 细腻微点阵网格 */}
          <div
            className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
            style={{
              backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          />
        </div>
      )}

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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsLayoutEditorOpen(true)}
            aria-label="编辑工作台布局"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-card/40 px-2.5 py-2 text-[10px] font-semibold text-muted-foreground backdrop-blur-xl shadow-sm transition-colors hover:text-foreground active:scale-95"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            卡片布局
          </button>

          {/* 实时数字时钟 */}
          <div className="rounded-xl border border-white/10 bg-card/40 px-3 py-1.5 backdrop-blur-xl shadow-sm text-right">
            <span className="font-mono text-sm font-black tracking-wider text-foreground">
              {timeString || "--:--:--"}
            </span>
            <p className="text-[9px] text-muted-foreground/70 font-mono">LOCAL TIME</p>
          </div>
        </div>
      </div>

      {/* 纯可视化卡片流 */}
      <div className="relative z-10 space-y-3">
        {visibleCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-card/30 p-6 text-center">
            <p className="text-xs text-muted-foreground">所有卡片都被隐藏了</p>
            <button
              type="button"
              onClick={() => setIsLayoutEditorOpen(true)}
              className="mt-2 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/30"
            >
              打开卡片布局
            </button>
          </div>
        ) : (
          visibleCards.map((card) => {
            const CardComponent = card.component;
            return <CardComponent key={card.id} />;
          })
        )}
      </div>

      <WorkbenchLayoutDialog
        open={isLayoutEditorOpen}
        onClose={() => setIsLayoutEditorOpen(false)}
        order={cardOrder}
        hidden={hiddenCardIds}
        onChange={(next) => {
          updateSettings((previous) => ({
            ...previous,
            workbenchCardLayout: next,
          }));
        }}
      />
    </div>
  );
}
