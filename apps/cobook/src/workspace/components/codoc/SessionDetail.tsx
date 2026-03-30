"use client";

import { useEffect, useState } from "react";
import { fetchDoc } from "@/workspace/stores/api-client";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Button } from "@/shared/ui/button";
import { X, Loader2, RefreshCw } from "lucide-react";
import type { DocSnapshot } from "@/shared/types";

interface Props {
  docId: string;
  onClose: () => void;
}

export function SessionDetail({ docId, onClose }: Props) {
  const [snap, setSnap] = useState<DocSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchDoc(docId)
      .then(setSnap)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [docId]);

  // Extract the /messages field value as plain text
  const messagesField = snap?.fields["/messages"];
  const rawText =
    messagesField?.status === "resolved" && Array.isArray(messagesField.value)
      ? messagesField.value
          .map((entry: unknown) => JSON.stringify(entry, null, 2))
          .join("\n\n")
      : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate">{docId}</h3>
          {messagesField && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {messagesField.status === "resolved" && Array.isArray(messagesField.value)
                ? `${messagesField.value.length} entries`
                : messagesField.status}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : rawText ? (
        <ScrollArea className="flex-1">
          <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
            {rawText}
          </pre>
        </ScrollArea>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">
            {messagesField?.status === "pending"
              ? "Loading data..."
              : messagesField?.status === "error"
                ? messagesField.error ?? "Failed to load"
                : "No data"}
          </p>
        </div>
      )}
    </div>
  );
}
