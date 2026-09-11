import { useMemo } from "react";
import { ModelCapabilityRegistry } from "../../application/services/llmCompatibility";
import { useTranslation } from "../../contexts/LanguageContext";
import type { ReasoningStrength } from "../../types";

interface ReasoningStrengthRowProps {
  label: string;
  description: string;
  value: ReasoningStrength;
  modelId: string;
  baseUrl: string;
  onChange: (value: ReasoningStrength) => void;
}

const STRENGTH_ORDER: readonly ReasoningStrength[] = ["auto", "off", "low", "medium", "high", "max"];

/**
 * 统一推理强度选择器。
 *
 * 可选项由当前端点与模型的能力解析决定：未识别的模型只有"自动"，
 * 无法关闭思考的模型不提供"关闭"，只支持开关的模型把低/中/高收敛为同一档。
 */
export default function ReasoningStrengthRow({
  label,
  description,
  value,
  modelId,
  baseUrl,
  onChange,
}: ReasoningStrengthRowProps) {
  const { t } = useTranslation();
  const support = useMemo(
    () => ModelCapabilityRegistry.describeReasoningControl(modelId, baseUrl),
    [modelId, baseUrl],
  );
  const selectable = support.selectableLevels;
  const options = useMemo(() => {
    const allowed = new Set<ReasoningStrength>(["auto", ...selectable, value]);
    return STRENGTH_ORDER.filter((level) => allowed.has(level));
  }, [selectable, value]);
  const unavailable = selectable.length === 0;
  const clamped = !unavailable && value !== "auto" && !selectable.includes(value);

  return (
    <div
      className="settings-toggle-row flex-col items-stretch gap-2"
      data-enabled={value !== "auto" ? "true" : "false"}
      data-disabled={unavailable ? "true" : "false"}
    >
      <div className="space-y-0.5">
        <label className="text-xs sm:text-[13px] font-semibold text-foreground leading-tight">{label}</label>
        <p className="text-[10.5px] leading-normal text-muted-foreground/75">{description}</p>
        {unavailable && (
          <p className="text-[10px] leading-normal text-amber-600 dark:text-amber-400">
            {t("api.reasoning_strength_unavailable")}
          </p>
        )}
        {clamped && (
          <p className="text-[10px] leading-normal text-amber-600 dark:text-amber-400">
            {t("api.reasoning_strength_clamped")}
          </p>
        )}
      </div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((level) => {
          const active = level === value;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(level)}
              className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition active:scale-95 ${
                active
                  ? "border-primary/40 bg-primary/15 text-primary shadow-xs"
                  : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {t(`api.reasoning_strength.${level}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
