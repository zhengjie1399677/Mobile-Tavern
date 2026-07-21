import { Gauge } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { PromptComposition } from "../../domain/prompt-composition";
import type { PromptCompositionPreviewData } from "./promptCompositionEditorTypes";
import {
  PromptComposerInput,
  PromptComposerSelect,
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
  const patch = (next: Partial<NonNullable<PromptComposition["tokenBudget"]>>) => {
    onChange({ ...composition, tokenBudget: { ...config, ...next } });
  };

  return (
    <details className="rounded-xl border border-border bg-muted/20 p-3">
      <summary className="cursor-pointer text-xs font-bold">
        <span className="inline-flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" />{t("prompt_composer.budget_title")}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-[11px] font-semibold">
          {t("prompt_composer.budget_enabled")}
          <PromptComposerSwitch
            checked={config.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
            aria-label={t("prompt_composer.budget_enabled")}
          />
        </div>
        {config.enabled && (
          <>
            <PromptComposerSelect
              value={config.mode}
              onValueChange={(value) => patch({ mode: value as "model" | "custom" })}
              ariaLabel={t("prompt_composer.budget_mode")}
              options={[
                { value: "model", label: t("prompt_composer.budget_model") },
                { value: "custom", label: t("prompt_composer.budget_custom") },
              ]}
            />
            {config.mode === "custom" && (
              <PromptComposerInput
                type="number"
                min={1}
                value={config.maxTokens ?? 4096}
                onChange={(event) => patch({ maxTokens: Math.max(1, Number(event.target.value) || 1) })}
                aria-label={t("prompt_composer.budget_limit")}
              />
            )}
          </>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground">{t("prompt_composer.budget_help")}</p>
        {preview?.budget && (
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-[10px] text-muted-foreground">
            {t("prompt_composer.budget_usage", {
              used: String(preview.budget.used),
              limit: String(preview.budget.limit),
              dropped: String(preview.budget.droppedBlockIds.length),
            })}
          </div>
        )}
      </div>
    </details>
  );
}
