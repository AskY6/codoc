"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { fetchDoc, fetchDocSource, renameDoc } from "@/workspace/stores/api-client";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Button } from "@/shared/ui/button";
import { X, Loader2, RefreshCw, User, Bot, Wrench, ChevronDown, ChevronRight, Code } from "lucide-react";
import type { DocSnapshot } from "@/shared/types";
import { cn } from "@/shared/utils";

interface Props {
  docId: string;
  onClose: () => void;
  onRenamed?: (oldId: string, newId: string) => void;
}

// ---------------------------------------------------------------------------
// Claude Code JSONL entry helpers
// ---------------------------------------------------------------------------

interface SessionEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  costUSD?: number;
  durationMs?: number;
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

function extractTextContent(entry: SessionEntry): string {
  const msg = entry.message;
  if (!msg?.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is ContentBlock => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n");
  }
  return "";
}

function extractToolNames(entry: SessionEntry): string[] {
  const msg = entry.message;
  if (!msg?.content || !Array.isArray(msg.content)) return [];
  return msg.content
    .filter((b): b is ContentBlock => b.type === "tool_use" && typeof b.name === "string")
    .map((b) => b.name!);
}

// ---------------------------------------------------------------------------
// Stats summary
// ---------------------------------------------------------------------------

interface SessionStats {
  total: number;
  byType: Map<string, number>;
  conversationCount: number;
}

function computeStats(entries: SessionEntry[]): SessionStats {
  const byType = new Map<string, number>();
  let conversationCount = 0;
  for (const e of entries) {
    const t = e.type ?? "unknown";
    byType.set(t, (byType.get(t) ?? 0) + 1);
    if (t === "human" || t === "assistant") conversationCount++;
  }
  return { total: entries.length, byType, conversationCount };
}

const TYPE_COLORS: Record<string, string> = {
  human: "bg-blue-100 text-blue-800",
  assistant: "bg-emerald-100 text-emerald-800",
  tool_use: "bg-amber-100 text-amber-800",
  tool_result: "bg-amber-50 text-amber-700",
  progress: "bg-gray-100 text-gray-600",
  "file-history-snapshot": "bg-gray-100 text-gray-600",
  result: "bg-purple-100 text-purple-800",
};

// ---------------------------------------------------------------------------
// Conversation entry component
// ---------------------------------------------------------------------------

function ConversationEntry({ entry, index }: { entry: SessionEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isHuman = entry.type === "human";
  const text = extractTextContent(entry);
  const toolNames = !isHuman ? extractToolNames(entry) : [];
  const isLong = text.length > 300;
  const displayText = isLong && !expanded ? text.slice(0, 300) + "…" : text;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        isHuman
          ? "border-blue-200 bg-blue-50/60"
          : "border-emerald-200 bg-emerald-50/40",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {isHuman ? (
          <User className="h-3.5 w-3.5 text-blue-600" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-emerald-600" />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            isHuman ? "text-blue-700" : "text-emerald-700",
          )}
        >
          {isHuman ? "Human" : "Assistant"}
        </span>
        {toolNames.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-600 ml-auto">
            <Wrench className="h-3 w-3" />
            {toolNames.join(", ")}
          </span>
        )}
      </div>
      {text ? (
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {displayText}
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground ml-1"
            >
              {expanded ? "show less" : "show more"}
            </button>
          )}
        </div>
      ) : toolNames.length > 0 ? (
        <div className="text-xs text-muted-foreground italic">
          (tool calls only)
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SessionDetail({ docId, onClose, onRenamed }: Props) {
  const [snap, setSnap] = useState<DocSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchDoc(docId)
      .then(setSnap)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const toggleSource = () => {
    if (!showSource && source === null) {
      setSourceLoading(true);
      fetchDocSource(docId)
        .then((s) => { setSource(s); setShowSource(true); })
        .catch((e) => setError(e.message))
        .finally(() => setSourceLoading(false));
    } else {
      setShowSource((v) => !v);
    }
  };

  const startEditing = () => {
    setEditValue(docId);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const submitRename = async () => {
    const newId = editValue.trim();
    if (!newId || newId === docId) {
      setEditing(false);
      return;
    }
    const finalId = newId.endsWith(".codoc") ? newId : newId + ".codoc";
    setRenaming(true);
    try {
      await renameDoc(docId, finalId);
      setEditing(false);
      onRenamed?.(docId, finalId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenaming(false);
    }
  };

  useEffect(() => {
    load();
    setSource(null);
    setShowSource(false);
    setEditing(false);
  }, [docId]);

  const messagesField = snap?.fields["/messages"];
  const rawEntries: SessionEntry[] = useMemo(() => {
    if (messagesField?.status !== "resolved" || !Array.isArray(messagesField.value))
      return [];
    return messagesField.value as SessionEntry[];
  }, [messagesField]);

  const stats = useMemo(() => computeStats(rawEntries), [rawEntries]);

  const conversation = useMemo(
    () => rawEntries.filter((e) => e.type === "human" || e.type === "assistant"),
    [rawEntries],
  );

  const otherEntries = useMemo(
    () => rawEntries.filter((e) => e.type !== "human" && e.type !== "assistant"),
    [rawEntries],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              disabled={renaming}
              className="text-sm font-medium w-full bg-transparent border-b border-primary outline-none py-0.5"
            />
          ) : (
            <h3
              className="text-sm font-medium truncate cursor-pointer hover:text-primary transition-colors"
              onClick={startEditing}
              title="Click to rename"
            >
              {docId}
            </h3>
          )}
          {messagesField && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {messagesField.status === "resolved" && Array.isArray(messagesField.value)
                ? `${messagesField.value.length} entries`
                : messagesField.status}
            </p>
          )}
        </div>
        <Button
          variant={showSource ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={toggleSource}
          disabled={sourceLoading}
          title="View source"
        >
          {sourceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Body */}
      {showSource && source !== null ? (
        <ScrollArea className="flex-1">
          <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
            {source}
          </pre>
        </ScrollArea>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : rawEntries.length > 0 ? (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Stats */}
            <div className="flex flex-wrap gap-1.5">
              {[...stats.byType.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <span
                    key={type}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      TYPE_COLORS[type] ?? "bg-gray-100 text-gray-600",
                    )}
                  >
                    {type} {count}
                  </span>
                ))}
            </div>

            {/* Conversation timeline */}
            {conversation.length > 0 && (
              <div className="space-y-2">
                {conversation.map((entry, i) => (
                  <ConversationEntry key={i} entry={entry} index={i} />
                ))}
              </div>
            )}

            {/* Other entries (collapsed) */}
            {otherEntries.length > 0 && (
              <div className="border rounded-lg">
                <button
                  onClick={() => setShowOther((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showOther ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {otherEntries.length} other entries (progress, snapshots, etc.)
                </button>
                {showOther && (
                  <pre className="px-3 pb-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all max-h-96 overflow-auto">
                    {otherEntries
                      .map((e) => JSON.stringify(e, null, 2))
                      .join("\n\n")}
                  </pre>
                )}
              </div>
            )}
          </div>
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
