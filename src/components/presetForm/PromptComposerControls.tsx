import type { ComponentProps, ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";

const EMPTY_OPTION_VALUE = "__prompt_composer_empty__";

const controlSurfaceClass = "border-border/80 bg-background/90 shadow-sm transition-[border-color,box-shadow,background-color,transform] focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20";

export function PromptComposerButton({
  className,
  variant = "outline",
  size = "lg",
  type = "button",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      data-prompt-control="button"
      className={cn(
        "min-h-9 touch-manipulation rounded-lg text-xs font-bold shadow-sm active:scale-[0.98] disabled:active:scale-100",
        className,
      )}
      {...props}
    />
  );
}

export function PromptComposerInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-prompt-control="input"
      className={cn("h-9 rounded-lg px-3 text-xs md:text-xs", controlSurfaceClass, className)}
      {...props}
    />
  );
}

export function PromptComposerTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-prompt-control="textarea"
      className={cn("rounded-lg px-3 py-2.5 text-xs md:text-xs", controlSurfaceClass, className)}
      {...props}
    />
  );
}

export function PromptComposerSwitch({ className, ...props }: ComponentProps<typeof Switch>) {
  return (
    <Switch
      data-prompt-control="switch"
      className={cn("focus-visible:ring-2 focus-visible:ring-primary/20", className)}
      {...props}
    />
  );
}

export interface PromptComposerSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export function PromptComposerSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly PromptComposerSelectOption[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const toInternalValue = (nextValue: string) => nextValue === "" ? EMPTY_OPTION_VALUE : nextValue;
  const fromInternalValue = (nextValue: unknown) => nextValue === EMPTY_OPTION_VALUE ? "" : String(nextValue);

  return (
    <Select
      value={toInternalValue(value)}
      onValueChange={(nextValue) => onValueChange(fromInternalValue(nextValue))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        data-prompt-control="select"
        className={cn("h-9 rounded-lg text-xs font-semibold", controlSurfaceClass, className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="z-[90] border border-border bg-popover p-1 shadow-xl">
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_OPTION_VALUE}
            value={toInternalValue(option.value)}
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
