import type {
  ThemeStateDefinition,
  ThemeStateValue,
} from "../../domain/themes/themeInteractionContract";
import { ThemeStudioSelect } from "./ThemeStudioSelect";
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
      <ThemeStudioSelect
        value={String(value)}
        options={[
          { value: "true", label: labels.booleanValue(true) },
          { value: "false", label: labels.booleanValue(false) },
        ]}
        onValueChange={next => onChange(next === "true")}
        className="w-full border-border bg-input text-[10px]"
        ariaLabel={ariaLabel}
        size="sm"
      />
    );
  }

  if (definition.type === "enum") {
    return (
      <ThemeStudioSelect
        value={typeof value === "string" ? value : definition.default}
        options={definition.values.map(option => ({ value: option, label: option }))}
        onValueChange={onChange}
        className="w-full border-border bg-input text-[10px]"
        ariaLabel={ariaLabel}
        size="sm"
      />
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
