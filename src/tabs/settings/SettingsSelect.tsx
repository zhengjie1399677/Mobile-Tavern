import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { cn } from "../../../lib/utils";

export interface SettingsSelectOption {
  value: string;
  label: ReactNode;
}

export default function SettingsSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SettingsSelectOption[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(String(nextValue))}>
      <SelectTrigger
        aria-label={ariaLabel}
        data-settings-control="select"
        className={cn("h-9 rounded-lg border-border/80 bg-background/80 text-xs font-bold shadow-sm focus-visible:ring-2 focus-visible:ring-primary/20", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="z-[90] border border-border bg-popover p-1 shadow-xl">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="min-h-9 px-2 text-xs font-medium">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
