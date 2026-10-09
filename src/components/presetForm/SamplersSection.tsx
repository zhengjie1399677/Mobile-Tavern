import { Sliders, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Card, CardHeader, CardContent } from "../../../components/ui/card";
import { useTranslation } from "../../contexts/LanguageContext";
import { cn } from "../../../lib/utils";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "../../domain/api/outputTokenLimits";
import type { UserSettings } from "../../types";

interface SamplersSectionProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  isSamplersFolded: boolean;
  handleToggleSamplersFold: () => void;
}

/** 2. 温度与采样参数 */
export default function SamplersSection({
  settings,
  updateSettings,
  isSamplersFolded,
  handleToggleSamplersFold,
}: SamplersSectionProps) {
  const { t } = useTranslation();

  // 快捷档位文案与当前语言绑定，故在组件内构造；纯数字档位无需翻译。
  const tempPills = [
    { label: t("samplers.pill_temp_strict"), value: 0.65 },
    { label: t("samplers.pill_temp_recommended"), value: 0.85 },
    { label: t("samplers.pill_temp_creative"), value: 1.15 },
  ] as const;

  const topPPills = [
    { label: t("samplers.pill_top_p_stable"), value: 0.9 },
    { label: t("samplers.pill_top_p_recommended"), value: 0.95 },
    { label: t("samplers.pill_top_p_full"), value: 1.0 },
  ] as const;

  const repPenaltyPills = [
    { label: t("samplers.pill_rep_none"), value: 1.0 },
    { label: t("samplers.pill_rep_recommended"), value: 1.05 },
    { label: t("samplers.pill_rep_strong"), value: 1.12 },
  ] as const;

  const maxTokensPills = [
    { label: "2K", value: 2048 },
    { label: "8K", value: 8192 },
    { label: "32K", value: 32768 },
    { label: t("samplers.pill_max_tokens_default"), value: DEFAULT_MAX_OUTPUT_TOKENS },
    { label: "256K", value: 262144 },
    { label: "1M", value: MAX_OUTPUT_TOKENS },
  ] as const;

  const handleResetDefaults = () => {
    updateSettings((prev) => ({
      ...prev,
      preset: {
        ...prev.preset,
        temperature: 0.85,
        topP: 0.95,
        repetitionPenalty: 1.05,
        maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
    }));
  };

  return (
    <Card className={cn("glass-panel shadow-sm transition-all duration-300 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs overflow-hidden", isSamplersFolded ? "gap-0" : "")}>
      <CardHeader
        className={cn("cursor-pointer hover:bg-muted/20 transition select-none py-2.5 px-3.5", isSamplersFolded ? "border-b-0" : "border-b border-border/30")}
        onClick={handleToggleSamplersFold}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Sliders className="w-4 h-4" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-xs sm:text-[13px] font-semibold text-foreground shrink-0">
                {t("samplers.title")}
              </span>
              {!isSamplersFolded && (
                <span className="text-[10px] text-muted-foreground/75 font-normal truncate max-w-[140px] sm:max-w-none">
                  {t("samplers.subtitle")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 overflow-hidden">
            {isSamplersFolded && (
              <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 truncate max-w-[130px] sm:max-w-none">
                T: {settings.preset.temperature} | P: {settings.preset.topP}
              </span>
            )}
            {isSamplersFolded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
      </CardHeader>
      {!isSamplersFolded && (
        <CardContent className="pt-3 px-3.5 pb-3.5 space-y-4 overflow-hidden w-full">
          {/* 快捷恢复推荐参数 */}
          <div className="flex justify-between items-center pb-1 border-b border-border/30 text-xs">
            <span className="text-[11px] text-muted-foreground/80">{t("samplers.quick_controls")}</span>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded-md hover:bg-muted/50 border border-border/40 transition active:scale-95"
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
              <span>{t("samplers.reset_recommended")}</span>
            </button>
          </div>

          <div className="space-y-4 text-xs w-full overflow-hidden">
            {/* 1. Temperature */}
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px] text-foreground/90">{t("samplers.temp")}</span>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/50 border border-border/40 text-foreground">
                  {settings.preset.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={settings.preset.temperature}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    preset: {
                      ...prev.preset,
                      temperature: parseFloat(e.target.value),
                    },
                  }))
                }
                className="w-full accent-primary h-1.5 bg-border rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {tempPills.map((pill) => {
                  const isSelected = Math.abs(settings.preset.temperature - pill.value) < 0.03;
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({
                          ...prev,
                          preset: { ...prev.preset, temperature: pill.value },
                        }))
                      }
                      className={cn(
                        "text-[10.5px] px-2 py-0.5 rounded-md border transition-all active:scale-95",
                        isSelected
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-400 font-semibold"
                          : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Top P */}
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px] text-foreground/90">{t("samplers.top_p")}</span>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/50 border border-border/40 text-foreground">
                  {settings.preset.topP}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.preset.topP}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    preset: {
                      ...prev.preset,
                      topP: parseFloat(e.target.value),
                    },
                  }))
                }
                className="w-full accent-primary h-1.5 bg-border rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {topPPills.map((pill) => {
                  const isSelected = Math.abs(settings.preset.topP - pill.value) < 0.03;
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({
                          ...prev,
                          preset: { ...prev.preset, topP: pill.value },
                        }))
                      }
                      className={cn(
                        "text-[10.5px] px-2 py-0.5 rounded-md border transition-all active:scale-95",
                        isSelected
                          ? "bg-sky-500/15 border-sky-500/40 text-sky-400 font-semibold"
                          : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Repetition Penalty */}
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px] text-foreground/90">
                  {t("samplers.rep_penalty")}
                </span>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/50 border border-border/40 text-foreground">
                  {settings.preset.repetitionPenalty}
                </span>
              </div>
              <input
                type="range"
                min="1.0"
                max="1.3"
                step="0.01"
                value={settings.preset.repetitionPenalty}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    preset: {
                      ...prev.preset,
                      repetitionPenalty: parseFloat(e.target.value),
                    },
                  }))
                }
                className="w-full accent-primary h-1.5 bg-border rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {repPenaltyPills.map((pill) => {
                  const isSelected = Math.abs(settings.preset.repetitionPenalty - pill.value) < 0.02;
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({
                          ...prev,
                          preset: { ...prev.preset, repetitionPenalty: pill.value },
                        }))
                      }
                      className={cn(
                        "text-[10.5px] px-2 py-0.5 rounded-md border transition-all active:scale-95",
                        isSelected
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 font-semibold"
                          : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Max Tokens */}
            <div className="space-y-2 w-full">
              <div className="flex justify-between items-center text-muted-foreground w-full">
                <span className="font-semibold text-[11px] text-foreground/90">
                  {t("samplers.max_tokens")}
                </span>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/50 border border-border/40 text-foreground">
                  {settings.preset.maxTokens}
                </span>
              </div>
              <input
                type="range"
                min="100"
                max={MAX_OUTPUT_TOKENS}
                step="1000"
                value={settings.preset.maxTokens}
                onChange={(e) =>
                  updateSettings((prev) => ({
                    ...prev,
                    preset: {
                      ...prev.preset,
                      maxTokens: parseInt(e.target.value),
                    },
                  }))
                }
                className="w-full accent-primary h-1.5 bg-border rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {maxTokensPills.map((pill) => {
                  const isSelected = settings.preset.maxTokens === pill.value;
                  return (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({
                          ...prev,
                          preset: { ...prev.preset, maxTokens: pill.value },
                        }))
                      }
                      className={cn(
                        "text-[10.5px] px-2 py-0.5 rounded-md border transition-all active:scale-95",
                        isSelected
                          ? "bg-violet-500/15 border-violet-500/40 text-violet-400 font-semibold"
                          : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      )}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
