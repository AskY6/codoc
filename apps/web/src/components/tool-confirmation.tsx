// Inline confirmation card for tool calls that require user approval.
//
// Shown during streaming when the agent wants to execute a mutating
// tool (createCodoc, updateCodoc, deleteCodoc). The user can approve
// or deny, which unblocks the backend tool loop.

import { Check, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

export interface ToolConfirmationProps {
  readonly requestId: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly onRespond: (requestId: string, approved: boolean) => void;
}

const TOOL_LABELS: Record<string, string> = {
  createCodoc: "Create codoc",
  updateCodoc: "Update codoc",
  deleteCodoc: "Delete codoc",
};

export function ToolConfirmation({
  requestId,
  tool,
  input,
  onRespond,
}: ToolConfirmationProps) {
  const [responded, setResponded] = useState<"approved" | "denied" | null>(
    null,
  );

  function handle(approved: boolean) {
    setResponded(approved ? "approved" : "denied");
    onRespond(requestId, approved);
  }

  const label = TOOL_LABELS[tool] ?? tool;

  if (responded) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          responded === "approved"
            ? "border-foreground/20 bg-foreground/5 text-foreground"
            : "border-border bg-muted text-muted-foreground line-through"
        }`}
      >
        {responded === "approved" ? (
          <Check className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
        {label}
        <span className="text-muted-foreground">
          {responded === "approved" ? "approved" : "denied"}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{label}</span>
      </div>

      {/* Input preview */}
      <pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
        {JSON.stringify(input, null, 2)}
      </pre>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => handle(true)}>
          <Check className="mr-1 h-3 w-3" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => handle(false)}>
          <X className="mr-1 h-3 w-3" />
          Deny
        </Button>
      </div>
    </div>
  );
}
