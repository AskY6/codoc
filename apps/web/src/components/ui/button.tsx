import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "./cn";

type Variant = "primary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40",
  outline:
    "border border-border bg-background text-foreground hover:bg-muted disabled:opacity-50",
  ghost:
    "bg-transparent text-foreground hover:bg-muted disabled:opacity-50",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  icon: "h-8 w-8 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
