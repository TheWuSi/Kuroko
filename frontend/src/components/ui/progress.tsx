import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }
>(({ className, value = 0, max = 100, indicatorClassName, ...props }, ref) => {
  const limit = Number.isFinite(max) && max > 0 ? max : 100
  const clamped = value === null ? null : Number.isFinite(value) ? Math.min(limit, Math.max(0, value)) : 0
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-2.5 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
      value={clamped}
      max={limit}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 bg-primary transition-all", indicatorClassName)}
        style={{ transform: `translateX(-${100 - ((clamped ?? 0) / limit) * 100}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
