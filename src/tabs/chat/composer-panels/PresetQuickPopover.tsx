import React from "react";
import { Popover } from "@base-ui/react/popover";
import {
  SlidersHorizontal,
  Flame,
  Percent,
  Check,
  X,
} from "lucide-react";
import { useMobileBackHandler } from "../../../hooks/useMobileBackHandler";
import { useTranslation } from "../../../contexts/LanguageContext";
import { useUnifiedApp } from "../../../UnifiedAppContext";
import { resolveActivePresetBundle } from "../../../application/useCases/presetBundleLifecycle";
import type { PresetBundle } from "../../../domain/presets/contracts";

interface PresetQuickPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly disabled?: boolean;
}

export function PresetQuickPopover({
  open,
  onOpenChange,
  disabled = false,
}: PresetQuickPopoverProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
    settings,
    updateSettings,
    handleLoadPresetBundle,
  } = useUnifiedApp((state) => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    handleLoadPresetBundle: state.handleLoadPresetBundle,
  }));

  useMobileBackHandler(open, () => {
    onOpenChange(false);
    return true;
  }, 870);

  const activeBundle = React.useMemo(
    () => resolveActivePresetBundle(settings.savedPresets, settings.preset),
    [settings.savedPresets, settings.preset],
  );

  const activeName = activeBundle?.sampler.name || settings.preset?.name || "Default";
  const temperature = settings.preset?.temperature ?? 0.7;
  const topP = settings.preset?.topP ?? 0.9;

  const handleTempChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextVal)) return;
    updateSettings((prev) => ({
      ...prev,
      preset: {
        ...(prev.preset || {}),
        temperature: Math.round(nextVal * 100) / 100,
      },
    }));
  };

  const handleTopPChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = Number.parseFloat(event.target.value);
    if (!Number.isFinite(nextVal)) return;
    updateSettings((prev) => ({
      ...prev,
      preset: {
        ...(prev.preset || {}),
        topP: Math.round(nextVal * 100) / 100,
      },
    }));
  };

  const handleSwitchPreset = async (bundleId: string) => {
    await handleLoadPresetBundle(bundleId);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label="预设调控"
        title="预设调控"
        disabled={disabled}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 transition-colors disabled:opacity-40 ${open
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-primary"
          }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span className="text-xs font-medium truncate max-w-[80px]">
          {activeName}
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={10}
          className="z-[1300]"
        >
          <Popover.Popup
            className="flex max-h-[72vh] w-[300px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-border/80 bg-popover text-popover-foreground shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-foreground">
                  {t("quick_actions.preset_title") || "预设调控"}
                </span>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => onOpenChange(false)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
              {/* 预设切换选择 */}
              {Array.isArray(settings.savedPresets) && settings.savedPresets.length > 1 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {t("quick_actions.preset_select_label") || "当前预设方案"}
                    </span>
                    <span className="text-[10px] text-primary font-medium">
                      {activeName}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-0.5">
                    {settings.savedPresets.map((bundle) => {
                      const isCurrent = bundle.id === activeBundle?.id;
                      const bundleName = bundle.sampler.name || bundle.id;
                      return (
                        <button
                          key={bundle.id}
                          type="button"
                          onClick={() => void handleSwitchPreset(bundle.id)}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${isCurrent
                              ? "bg-primary text-primary-foreground shadow-xs"
                              : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                          {isCurrent && <Check className="h-3 w-3" />}
                          <span className="truncate max-w-[110px]">{bundleName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 温度 (Temperature) */}
              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/50 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Flame className="h-3.5 w-3.5 text-amber-500" />
                    <span>{t("quick_actions.preset_temperature") || "温度 (Temperature)"}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-primary">
                    {temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={temperature}
                  onChange={handleTempChange}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{t("quick_actions.preset_precise") || "严谨精确 (0.0)"}</span>
                  <span>{t("quick_actions.preset_balance") || "平衡 (1.0)"}</span>
                  <span>{t("quick_actions.preset_creative") || "创意天马 (2.0)"}</span>
                </div>
              </div>

              {/* 采样核 (Top-P) */}
              <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/50 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Percent className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{t("quick_actions.preset_top_p") || "采样核 (Top-P)"}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-primary">
                    {topP.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={topP}
                  onChange={handleTopPChange}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>严苛 (0.1)</span>
                  <span>标准 (0.9)</span>
                  <span>完全放开 (1.0)</span>
                </div>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
