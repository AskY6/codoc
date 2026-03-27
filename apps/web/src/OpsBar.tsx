import type { MultiDocRuntime } from "./runtime.js";
import { Button } from "@/components/ui/button";

interface Op {
  label: string;
  action: () => void;
}

export function OpsBar({ multi }: { multi: MultiDocRuntime }) {
  const ops: Op[] = [
    { label: 'projectName → "SuperDoc"', action: () => multi.update("B.codoc", "/projectName", "SuperDoc") },
    { label: 'version → "1.0.0"', action: () => multi.update("B.codoc", "/version", "1.0.0") },
    { label: 'status → "Released!"', action: () => multi.update("B.codoc", "/status", "Released!") },
    { label: "forceAll()", action: () => multi.forceAll() },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground mr-1">
        Update B.codoc:
      </span>
      {ops.map((op) => (
        <Button key={op.label} variant="outline" size="sm" onClick={op.action}>
          <code className="text-xs">{op.label}</code>
        </Button>
      ))}
    </div>
  );
}
