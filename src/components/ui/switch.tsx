"use client"

import { useId } from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/src/lib/utils"

function Switch({
  className,
  size = "default",
  "aria-label": ariaLabel,
  id: idProp,
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  const generatedId = useId()
  const switchId = idProp ?? (ariaLabel ? `switch-${generatedId}` : undefined)

  return (
    <>
      {ariaLabel && switchId && (
        <label
          htmlFor={switchId}
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: 0,
            margin: "-1px",
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {ariaLabel}
        </label>
      )}
      <SwitchPrimitive.Root
        id={switchId}
        data-slot="switch"
        data-size={size}
        className={cn(
          "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 outline-none select-none after:absolute after:-inset-x-3 after:-inset-y-2 after:content-['']",
          "data-[size=default]:h-5 data-[size=default]:w-9",
          "data-[size=sm]:h-4 data-[size=sm]:w-7",
          "data-checked:bg-primary data-unchecked:bg-muted-foreground/30 dark:data-unchecked:bg-muted/80",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "pointer-events-none block shrink-0 rounded-full bg-white shadow-xs ring-0 transition-transform duration-200 ease-in-out",
            "group-data-[size=default]/switch:size-4",
            "group-data-[size=sm]/switch:size-3",
            "group-data-[size=default]/switch:data-unchecked:translate-x-0",
            "group-data-[size=default]/switch:data-checked:translate-x-4",
            "group-data-[size=sm]/switch:data-unchecked:translate-x-0",
            "group-data-[size=sm]/switch:data-checked:translate-x-3",
          )}
        />
      </SwitchPrimitive.Root>
    </>
  )
}

export { Switch }
