import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Styled checkbox. Renders as a `<span>` so it can safely live inside
 * buttons / other interactive containers. Pass `render={<button />}` if
 * you need a standalone interactive checkbox.
 */
function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props & { className?: string }) {
  return (
    <CheckboxPrimitive.Root
      render={<span />}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background transition-colors data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
