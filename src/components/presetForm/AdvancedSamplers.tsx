import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import type { UserSettings } from "../../types";

interface AdvancedSamplersProps {
  settings: UserSettings;
  updateSettings: (newSet: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
}

type NumericSamplerField =
  | "topK"
  | "minP"
  | "topA"
  | "frequencyPenalty"
  | "presencePenalty"
  | "seed";

interface FieldSpec {
  field: NumericSamplerField;
  labelKey: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  integer?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  { field: "topK", labelKey: "samplers.top_k", min: 0, max: 1000, step: 1, fallback: 0, integer: true },
  { field: "minP", labelKey: "samplers.min_p", min: 0, max: 1, step: 0.01, fallback: 0 },
  { field: "topA", labelKey: "samplers.top_a", min: 0, max: 1, step: 0.01, fallback: 0 },
  { field: "frequencyPenalty", labelKey: "samplers.frequency_penalty", min: -2, max: 2, step: 0.1, fallback: 0 },
  { field: "presencePenalty", labelKey: "samplers.presence_penalty", min: -2, max: 2, step: 0.1, fallback: 0 },
  // seed 的 -1 是 ST 的“随机”约定；固定种子才发送给服务端。
  { field: "seed", labelKey: "samplers.seed", min: -1, max: 2_147_483_647, step: 1, fallback: -1, integer: true },
];

/**
 * 高级采样参数：补齐 SillyTavern 预设里常见但此前未暴露的字段。
 *
 * 默认折叠，避免把设置页首屏撑满；所有值仍写入同一个 `SamplerPreset`，
 * 因此导入、导出、预设切换与 Agent Profile 采样保持同一条数据通道。
 */
export function AdvancedSamplers({ settings, updateSettings }: AdvancedSamplersProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  // 输入中的原始文本单独持有：否则清空输入框会被受控值立刻还原，无法重新输入。
  const [drafts, setDrafts] = React.useState<Partial<Record<NumericSamplerField, string>>>({});

  React.useEffect(() => {
    setDrafts({});
  }, [settings.preset.id]);

  const updateField = (field: NumericSamplerField, raw: string) => {
    setDrafts((prev) => ({ ...prev, [field]: raw }));
    const spec = FIELDS.find((item) => item.field === field);
    if (!spec) return;
    const parsed = spec.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(spec.max, Math.max(spec.min, parsed));
    updateSettings((prev) => ({
      ...prev,
      preset: { ...prev.preset, [field]: clamped },
    }));
  };

  const clearDraft = (field: NumericSamplerField) => {
    setDrafts((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const readValue = (field: NumericSamplerField, fallback: number): number => {
    const value = settings.preset[field];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/15">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
        aria-expanded={isOpen}
      >
        <span className="flex flex-col items-start">
          <span className="text-[11px] font-semibold text-foreground/90">{t("samplers.advanced")}</span>
          <span className="text-[10px] text-muted-foreground/75">{t("samplers.advanced_hint")}</span>
        </span>
        {isOpen
          ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      </button>
      {isOpen && (
        <div className="grid grid-cols-2 gap-2.5 border-t border-border/30 px-3 pb-3 pt-2.5">
          {FIELDS.map((spec) => {
            const value = readValue(spec.field, spec.fallback);
            return (
              <label key={spec.field} className="flex flex-col gap-1">
                <span className="text-[10.5px] font-medium text-muted-foreground">
                  {t(spec.labelKey)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={drafts[spec.field] ?? String(value)}
                  onChange={(event) => updateField(spec.field, event.target.value)}
                  onBlur={() => clearDraft(spec.field)}
                  className="h-8 w-full rounded-lg border border-border/70 bg-background/80 px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                />
              </label>
            );
          })}
          <p className="col-span-2 text-[10px] leading-relaxed text-muted-foreground/75">
            {t("samplers.seed_hint")}
          </p>
        </div>
      )}
    </div>
  );
}
