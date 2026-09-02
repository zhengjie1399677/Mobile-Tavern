import { AlertTriangle, ChevronDown, Gauge, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptComposition } from "../../domain/prompt-composition";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";
import {
  PromptComposerButton,
  PromptComposerInput,
  PromptComposerSegmentedControl,
  PromptComposerSwitch,
} from "./PromptComposerControls";

export default function PromptCompositionBudgetSettings({
  composition,
  preview,
  onChange,
}: {
  composition: PromptComposition;
  preview?: PromptCompositionPreviewData;
  onChange: (composition: PromptComposition) => void;
}) {
  const { t } = useTranslation();
  const config = composition.tokenBudget ?? { enabled: true, mode: "model" as const };
  const [expanded, setExpanded] = useState(true);

  const patch = (next: Partial<NonNullable<PromptComposition["tokenBudget"]>>) => {
    onChange({ ...composition, tokenBudget: { ...config, ...next } });
  };

  const usedTokens = preview?.budget?.used ?? 0;
  const limitTokens = preview?.budget?.limit ?? (config.mode === "custom" ? (config.maxTokens ?? 4096) : 4096);
  const percent = limitTokens > 0 ? Math.min(100, Math.max(0, Math.round((usedTokens / limitTokens) * 100))) : 0;
  const droppedCount = preview?.budget?.droppedBlockIds?.length ?? 0;

  const barGradient = percent > 90
    ? "from-rose-500 to-red-600 shadow-rose-500/30"
    : percent > 75
      ? "from-amber-500 to-orange-500 shadow-amber-500/30"
      : "from-emerald-500 to-teal-400 shadow-emerald-500/20";

  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs transition-all duration-150 shadow-xs">
      <PromptComposerButton
        onClick={() => setExpanded((prev) => !prev)}
        variant="ghost"
        className="flex w-full items-center justify-between p-3 text-left font-bold text-xs hover:bg-muted/20 rounded-2xl transition-colors h-auto min-h-0"
      >
        <span className="inline-flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-xs">
            <Gauge className="h-3.5 w-3.5" />
          </span>
          <span>{t("prompt_composer.budget_title")}</span>
          {config.enabled && preview?.budget && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] font-bold text-primary">
              {percent}%
            </span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </PromptComposerButton>

      {expanded && (
        <div className="space-y-3 px-3 pb-3.5 pt-1 border-t border-border/50">
          {/* 开关行 */}
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/80 px-3 py-2.5 text-[11px] font-semibold shadow-xs">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("prompt_composer.budget_enabled")}
            </span>
            <PromptComposerSwitch
              checked={config.enabled}
              onCheckedChange={(checked) => patch({ enabled: checked })}
              aria-label={t("prompt_composer.budget_enabled")}
            />
          </div>

          {config.enabled && (
            <>
              {/* 模式分段选择器 */}
              <PromptComposerSegmentedControl
                value={config.mode}
                onValueChange={(value) => patch({ mode: value })}
                ariaLabel={t("prompt_composer.budget_mode")}
                options={[
                  { value: "model", label: t("prompt_composer.budget_model") },
                  { value: "custom", label: t("prompt_composer.budget_custom") },
                ]}
              />

              {config.mode === "custom" && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground">
                    {t("prompt_composer.budget_limit") || "Token 上限"}
                  </label>
                  <PromptComposerInput
                    type="number"
                    min={1}
                    value={config.maxTokens ?? 4096}
                    onChange={(event) => patch({ maxTokens: Math.max(1, Number(event.target.value) || 1) })}
                    aria-label={t("prompt_composer.budget_limit")}
                    className="font-mono text-xs"
                  />
                </div>
              )}

              {/* 实时预算监控进度条 */}
              {preview?.budget && (
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/70 p-3 shadow-2xs">
                  <div className="flex items-center justify-between text-[10px] font-semibold">
                    <span className="text-muted-foreground">实时 Token 使用量</span>
                    <span className="font-mono text-foreground font-bold">
                      {usedTokens.toLocaleString()} / {limitTokens.toLocaleString()} T ({percent}%)
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60 p-0.5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-300 shadow-xs ${barGradient}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {droppedCount > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>已因超出预算丢弃 {droppedCount} 个低优先级区块</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t("prompt_composer.budget_help")}
          </p>
        </div>
      )}
    </section>
  );
}
