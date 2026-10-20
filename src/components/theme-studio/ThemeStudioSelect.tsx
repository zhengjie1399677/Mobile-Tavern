import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";

export interface ThemeStudioSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * 主题工作室统一的下拉控件。
 *
 * 原生 `<select>` 在 Android WebView 会弹出系统白色列表，与主题工作室的
 * 现代 UI 完全割裂；这里统一使用应用内的 Base UI Select。
 */
export function ThemeStudioSelect({
  value,
  options,
  onValueChange,
  placeholder,
  ariaLabel,
  className,
  size = "sm",
  disabled = false,
}: {
  value: string;
  options: ThemeStudioSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "default";
  disabled?: boolean;
}) {
  const selected = options.find(option => option.value === value);
  const hasValue = value !== "";
  return (
    <Select<string>
      value={hasValue ? value : null}
      onValueChange={next => {
        if (next === null) return;
        onValueChange(next);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        size={size}
        className={className}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder}>
          {selected?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
