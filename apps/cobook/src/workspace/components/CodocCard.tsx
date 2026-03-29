"use client";

import { useState } from "react";
import { fetchDoc } from "@/workspace/api-client";
import type { DocSnapshot, FieldSnapshot } from "@/shared/types";
import { FileText, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/utils";

interface CodocCardProps {
  docId: string;
  defaultExpanded?: boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? "");
}

const statusDot: Record<string, string> = {
  resolved: "bg-emerald-500",
  pending: "bg-amber-500 animate-pulse",
  error: "bg-red-500",
  dirty: "bg-amber-400",
  idle: "bg-muted-foreground/30",
};

export function CodocCard({ docId, defaultExpanded = false }: CodocCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [doc, setDoc] = useState<DocSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!doc && !loading) {
      setLoading(true);
      try {
        const snapshot = await fetchDoc(docId);
        setDoc(snapshot);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
  };

  const fieldCount = doc ? Object.keys(doc.fields).length : undefined;

  return (
    <div className="rounded-lg border bg-card text-card-foreground overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors text-sm"
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-medium truncate flex-1">{docId}</span>
        {fieldCount !== undefined && (
          <span className="text-xs text-muted-foreground">
            {fieldCount} field{fieldCount !== 1 ? "s" : ""}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Loading fields…</span>
            </div>
          )}
          {error && <p className="text-xs text-destructive py-1">{error}</p>}
          {doc &&
            Object.entries(doc.fields).map(([path, field]) => (
              <FieldRow key={path} path={path} field={field} />
            ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ path, field }: { path: string; field: FieldSnapshot }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <div
        className={cn(
          "h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0",
          statusDot[field.status] ?? statusDot.idle,
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-muted-foreground">{path}</span>
        {field.status === "resolved" && field.value !== undefined && (
          <pre className="mt-0.5 text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {formatValue(field.value)}
          </pre>
        )}
        {field.status === "error" && field.error && (
          <p className="mt-0.5 text-destructive">{field.error}</p>
        )}
        {(field.status === "idle" || field.status === "pending") && (
          <p className="mt-0.5 text-muted-foreground italic">
            {field.status === "pending" ? "computing…" : "not computed"}
          </p>
        )}
      </div>
    </div>
  );
}
