import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, onInput, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      onInput={(e) => {
        // field-sizing: content 的 JS 兜底（CR-06）：在不支持该 CSS 特性的 WebView 上，
        // 根据内容自动调整 textarea 高度。若 field-sizing 已生效，此调整与之协调无冲突。
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
        onInput?.(e);
      }}
      {...props}
    />
  )
}

export { Textarea }
