"use client";

import { useCurrentDocId } from "@/hooks/use-current-doc";
import { useFieldSnapshot } from "@/hooks/use-field-snapshot";

function format(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? "");
}

export function CodataValue({ path }: { path: string }) {
  const docId = useCurrentDocId();
  const snap = useFieldSnapshot(docId, path);

  if (!snap || snap.status === "idle" || snap.status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <span className="text-xs">computing…</span>
      </span>
    );
  }

  if (snap.status === "error") {
    return (
      <span className="text-destructive text-sm bg-red-50 px-1.5 py-0.5 rounded">
        {snap.error}
      </span>
    );
  }

  if (snap.status === "dirty") {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="opacity-60">{format(snap.value)}</span>
        <span className="text-xs text-amber-600 bg-amber-50 px-1 py-0.5 rounded">stale</span>
      </span>
    );
  }

  return <>{format(snap.value)}</>;
}
