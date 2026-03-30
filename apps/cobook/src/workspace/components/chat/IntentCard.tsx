"use client";

import { useState } from "react";
import { updateIntent } from "@/workspace/stores/api-client";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import { Check, X, Pencil, RefreshCw, Loader2 } from "lucide-react";

interface IntentCardProps {
  intent: {
    kind: string;
    payload: unknown;
    status: "proposed" | "confirmed" | "rejected";
  };
  messageId: string;
  intentIdx: number;
}

function describeIntent(kind: string, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  switch (kind) {
    case "write-codoc-field":
      return `Write to ${p.docId} field ${p.field}`;
    case "force-codoc-field":
      return `Force refresh ${p.docId} field ${p.field}`;
    case "create-codoc":
      return `Create codoc ${p.docId}`;
    case "delete-codoc":
      return `Delete codoc ${p.docId}`;
    default:
      return `${kind}`;
  }
}

function intentIcon(kind: string) {
  if (kind.startsWith("force")) return <RefreshCw className="h-3.5 w-3.5" />;
  return <Pencil className="h-3.5 w-3.5" />;
}

function previewValue(kind: string, payload: unknown): string | null {
  const p = payload as Record<string, unknown>;
  if (kind === "write-codoc-field" && p.value !== undefined) {
    const val = typeof p.value === "string" ? p.value : JSON.stringify(p.value, null, 2);
    return val.length > 200 ? val.slice(0, 200) + "…" : val;
  }
  return null;
}

export function IntentCard({ intent, messageId, intentIdx }: IntentCardProps) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (status: "confirmed" | "rejected") => {
    setLoading(true);
    try {
      await updateIntent(messageId, intentIdx, status);
    } finally {
      setLoading(false);
    }
  };

  const description = describeIntent(intent.kind, intent.payload);
  const preview = previewValue(intent.kind, intent.payload);

  return (
    <div
      className={cn(
        "rounded-lg border text-sm overflow-hidden",
        intent.status === "proposed" && "border-blue-200 bg-blue-50/50",
        intent.status === "confirmed" && "border-emerald-200 bg-emerald-50/50",
        intent.status === "rejected" && "border-red-200 bg-red-50/30 opacity-60",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex-shrink-0",
            intent.status === "proposed" && "text-blue-600",
            intent.status === "confirmed" && "text-emerald-600",
            intent.status === "rejected" && "text-red-500",
          )}
        >
          {intentIcon(intent.kind)}
        </span>
        <span className="flex-1 text-xs font-medium truncate">{description}</span>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
            intent.status === "proposed" && "bg-blue-100 text-blue-700",
            intent.status === "confirmed" && "bg-emerald-100 text-emerald-700",
            intent.status === "rejected" && "bg-red-100 text-red-600",
          )}
        >
          {intent.status}
        </span>
      </div>

      {preview && (
        <div className="px-3 pb-2">
          <pre className="text-xs text-muted-foreground bg-background/60 rounded px-2 py-1.5 whitespace-pre-wrap break-words max-h-24 overflow-auto font-mono">
            {preview}
          </pre>
        </div>
      )}

      {intent.status === "proposed" && (
        <div className="flex gap-1.5 px-3 pb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
            disabled={loading}
            onClick={() => handleAction("confirmed")}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={loading}
            onClick={() => handleAction("rejected")}
          >
            <X className="h-3 w-3" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
