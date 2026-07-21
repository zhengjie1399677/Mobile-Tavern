import type { ComponentProps, ReactNode } from "react";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";

const EMPTY_OPTION_VALUE = "__memory_drawer_empty__";
const controlSurfaceClass = "border-border/80 bg-background/90 shadow-sm transition-[border-color,box-shadow,background-color] focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20";

export function MemoryDrawerInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-memory-control="input"
      className={cn("h-9 rounded-lg px-2.5 text-xs md:text-xs", controlSurfaceClass, className)}
      {...props}
    />
  );
}

export function MemoryDrawerTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-memory-control="textarea"
      className={cn("rounded-lg px-2.5 py-2 text-xs md:text-xs", controlSurfaceClass, className)}
      {...props}
    />
  );
}

export interface MemoryDrawerSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export function MemoryDrawerSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly MemoryDrawerSelectOption[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const internalValue = value === "" ? EMPTY_OPTION_VALUE : value;

  return (
    <Select
      value={internalValue}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_OPTION_VALUE ? "" : String(nextValue))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        data-memory-control="select"
        className={cn("h-9 rounded-lg text-xs font-semibold", controlSurfaceClass, className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="z-[90] border border-border bg-popover p-1 shadow-xl">
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_OPTION_VALUE}
            value={option.value === "" ? EMPTY_OPTION_VALUE : option.value}
            disabled={option.disabled}
            className="min-h-9 px-2 text-xs font-medium"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
