// Minimal headless dialog. Hand-rolled instead of pulling in Radix /
// shadcn for slice 1 — we want to know exactly what we own. The first
// slice that needs more dialog behaviour (focus trap edge cases,
// stacked dialogs) replaces this with a real impl.
//
// Behaviour:
//   - rendered as a fixed-position overlay + centered panel
//   - clicking the backdrop calls `onOpenChange(false)`
//   - pressing Escape calls `onOpenChange(false)`
//   - returns null when `open` is false (no portal needed for slice 1)

import { useEffect, type ReactNode } from "react";
import { cn } from "./cn";

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {children}
    </div>
  );
}

export interface DialogContentProps {
  readonly className?: string;
  readonly children: ReactNode;
}

export function DialogContent({ className, children }: DialogContentProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-col gap-1">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-medium text-neutral-900">{children}</h2>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}
