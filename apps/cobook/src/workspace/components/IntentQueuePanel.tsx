"use client";

import { useState } from "react";
import {
  useIntentRecords,
  confirmIntent,
  rejectIntent,
  previewIntent,
} from "@/workspace/hooks/use-intent-queue";
import type { IntentRecordView } from "@/workspace/stores/intent-queue-store";
import type { IntentStatus } from "@/intent-queue/types";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import {
  Check,
  X,
  Eye,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
} from "lucide-react";

const STATUS_CONFIG: Record<
  IntentStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  pending: { label: "Pending", color: "text-yellow-500", icon: Clock },
  previewed: { label: "Previewed", color: "text-blue-500", icon: Eye },
  confirmed: { label: "Confirmed", color: "text-green-500", icon: Check },
  rejected: { label: "Rejected", color: "text-red-400", icon: XCircle },
  executed: { label: "Executed", color: "text-emerald-500", icon: CheckCircle2 },
  propagated: { label: "Done", color: "text-emerald-600", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-destructive", icon: XCircle },
};

type FilterTab = "pending" | "all" | "done";

export function IntentQueuePanel({ onClose }: { onClose: () => void }) {
  const records = useIntentRecords();
  const [tab, setTab] = useState<FilterTab>("pending");

  const filtered = records.filter((r) => {
    if (tab === "pending") return r.status === "pending" || r.status === "previewed";
    if (tab === "done")
      return (
        r.status === "executed" ||
        r.status === "propagated" ||
        r.status === "rejected" ||
        r.status === "failed"
      );
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-4 pb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Intent Queue
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pb-2">
        {(["pending", "all", "done"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-xs px-2 py-1 rounded transition-colors",
              tab === t
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "pending" ? "Pending" : t === "all" ? "All" : "Done"}
            {t === "pending" && (
              <span className="ml-1">
                ({records.filter((r) => r.status === "pending" || r.status === "previewed").length})
              </span>
            )}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2 space-y-1">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Zap className="h-6 w-6 opacity-30" />
              <p className="text-xs">No intents</p>
            </div>
          )}
          {filtered.map((record) => (
            <IntentCard key={record.id} record={record} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function IntentCard({ record }: { record: IntentRecordView }) {
  const [loading, setLoading] = useState(false);
  const config = STATUS_CONFIG[record.status];
  const StatusIcon = config.icon;

  const handleAction = async (action: "confirm" | "reject" | "preview") => {
    setLoading(true);
    try {
      if (action === "confirm") await confirmIntent(record.id);
      else if (action === "reject") await rejectIntent(record.id);
      else await previewIntent(record.id);
    } finally {
      setLoading(false);
    }
  };

  const canAct = record.status === "pending" || record.status === "previewed";

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <StatusIcon className={cn("h-3.5 w-3.5", config.color)} />
        <span className={cn("text-[10px] font-medium uppercase", config.color)}>
          {config.label}
        </span>
        {record.flags.conflicted && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
            <AlertTriangle className="h-2.5 w-2.5" />
            conflict
          </span>
        )}
        {record.flags.stale && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            stale
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {record.source}
        </span>
      </div>

      {/* Target */}
      <div className="text-[11px] text-muted-foreground">
        <span className="font-mono">{record.target.docId}</span>
        {record.target.field && (
          <span className="font-mono text-foreground/60"> → {record.target.field}</span>
        )}
      </div>

      {/* Content */}
      <p className="text-sm leading-relaxed">{record.content}</p>

      {/* Actions */}
      {canAct && (
        <div className="flex gap-1.5 pt-1">
          {record.status === "pending" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleAction("preview")}
              disabled={loading}
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleAction("confirm")}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Check className="h-3 w-3 mr-1" />
            )}
            Confirm
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => handleAction("reject")}
            disabled={loading}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
