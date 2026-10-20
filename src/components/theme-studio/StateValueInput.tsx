import type {
  ThemeStateDefinition,
  ThemeStateValue,
} from "../../domain/themes/themeInteractionContract";
import { useThemeStudioTypeLabels } from "./themeStudioTypeLabels";

export function StateValueInput({
  definition,
  value,
  onChange,
  ariaLabel,
}: {
  definition: ThemeStateDefinition | undefined;
  value: ThemeStateValue;
  onChange: (value: ThemeStateValue) => void;
  ariaLabel?: string;
}) {
  const labels = useThemeStudioTypeLabels();
  if (!definition) return null;

  if (definition.type === "boolean") {
    return (
      <select
        aria-label={ariaLabel}
        value={String(value)}
        onChange={event => onChange(event.target.value === "true")}
        className="h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
      >
        <option value="true">{labels.booleanValue(true)}</option>
        <option value="false">{labels.booleanValue(false)}</option>
      </select>
    );
  }

  if (definition.type === "enum") {
    return (
      <select
        aria-label={ariaLabel}
        value={typeof value === "string" ? value : definition.default}
        onChange={event => onChange(event.target.value)}
        className="h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
      >
        {definition.values.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  return (
    <input
      aria-label={ariaLabel}
      type="number"
      value={typeof value === "number" ? value : definition.default}
      onChange={event => onChange(Number.parseInt(event.target.value, 10) || 0)}
      className="h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
    />
  );
}
