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
    return <span className="text-muted-foreground animate-pulse">...</span>;
  }

  if (snap.status === "error") {
    return <span className="text-destructive text-sm">{snap.error}</span>;
  }

  if (snap.status === "dirty") {
    return <span className="opacity-50">{format(snap.value)}</span>;
  }

  return <>{format(snap.value)}</>;
}
