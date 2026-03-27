import { useState, useEffect, useRef } from "react";
import type { MultiDocRuntime } from "../runtime/runtime.js";
import { Button } from "@/components/ui/button";

interface Op {
  label: string;
  action: () => void;
}

export function OpsBar({ multi }: { multi: MultiDocRuntime }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const ops: Op[] = [
    { label: 'product.name → "iPad Air"', action: () => multi.update("product.codoc", "/name", "iPad Air") },
    { label: "product.price → 599", action: () => multi.update("product.codoc", "/price", 599) },
    { label: 'user.name → "Bob Li"', action: () => multi.update("user.codoc", "/name", "Bob Li") },
    { label: 'user.role → "VIP"', action: () => multi.update("user.codoc", "/role", "VIP") },
    { label: "forceAll()", action: () => multi.forceAll() },
  ];

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        <code className="text-xs">Operations</code>
        <span className="ml-1 text-[10px]">{open ? "▲" : "▼"}</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 flex flex-col gap-1 rounded-lg border bg-background p-2 shadow-md">
          {ops.map((op) => (
            <Button
              key={op.label}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                op.action();
                setOpen(false);
              }}
            >
              <code className="text-xs">{op.label}</code>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
