import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { ExternalLink, Sparkles, FileText } from "lucide-react";
import { useCodocActions } from "./codoc-context.js";
import type { ViewAction } from "@/types.js";

export interface TimelineItem {
  title?: string;
  pubDate?: string;
  link?: string;
  summary?: string;
  readAt?: string | null;
  feedTitle?: string;
  [key: string]: unknown;
}

interface TimelineProps {
  items: TimelineItem[];
  /** Generate a chat action for an item. If omitted, no AI Summary button. */
  itemAction?: (item: TimelineItem, index: number) => ViewAction;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

interface MetaPair {
  key: string;
  value: string;
  isUrl: boolean;
}

function extractMetadata(text: string): {
  urls: MetaPair[];
  stats: MetaPair[];
  isMetadataOnly: boolean;
} {
  const kvPattern = /(?:^|\s)([\w\s]+?):\s+(https?:\/\/\S+|\d+)/g;
  const urls: MetaPair[] = [];
  const stats: MetaPair[] = [];
  let match: RegExpExecArray | null;
  while ((match = kvPattern.exec(text)) !== null) {
    const raw = match[1]?.trim();
    const value = match[2];
    if (raw && value) {
      const key = raw.replace(/\s*URL$/i, "");
      const isUrl = value.startsWith("http");
      (isUrl ? urls : stats).push({ key, value, isUrl });
    }
  }
  return { urls, stats, isMetadataOnly: urls.length + stats.length >= 2 };
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function tryParseDate(str: string): Date | undefined {
  const trimmed = str.trim();
  if (!trimmed) return undefined;
  if (
    /^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
    /^\w{3},\s\d{2}\s\w{3}\s\d{4}/.test(trimmed)
  ) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

function formatDateShort(d: Date): string {
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0)
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Feed source tag colors — deterministic per feed name
// ---------------------------------------------------------------------------

const TAG_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
];

function feedTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Timeline component
// ---------------------------------------------------------------------------

export function Timeline({ items, itemAction }: TimelineProps) {
  const { onAction } = useCodocActions();
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const toggle = useCallback((i: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (items.length === 0) return;
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, items.length - 1);
          setFocusedIndex(next);
          itemRefs.current.get(next)?.scrollIntoView({ block: "nearest" });
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          itemRefs.current.get(prev)?.scrollIntoView({ block: "nearest" });
          break;
        }
        case "Enter": {
          e.preventDefault();
          toggle(focusedIndex);
          break;
        }
        case "o": {
          e.preventDefault();
          const item = items[focusedIndex];
          if (item?.link) window.open(item.link, "_blank", "noopener,noreferrer");
          break;
        }
        case "m": {
          e.preventDefault();
          const item = items[focusedIndex];
          if (item && itemAction && onAction) {
            onAction(itemAction(item, focusedIndex));
          }
          break;
        }
      }
    },
    [items, focusedIndex, toggle, onAction, itemAction],
  );

  return (
    <div
      ref={containerRef}
      className="space-y-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) => {
        const isRead = Boolean(item.readAt);
        const isExpanded = expandedSet.has(i);
        const isFocused = focusedIndex === i;
        const meta = item.summary
          ? extractMetadata(item.summary)
          : { urls: [], stats: [], isMetadataOnly: false };
        const dateStr = item.pubDate ?? "";
        const parsed = tryParseDate(dateStr);

        return (
          <div
            key={i}
            ref={(el) => {
              if (el) itemRefs.current.set(i, el);
            }}
            className={`rounded-lg px-4 py-3 transition-all ${
              isFocused
                ? "bg-muted/80 ring-1 ring-primary/20"
                : "hover:bg-muted/50"
            } ${isRead ? "text-muted-foreground" : ""}`}
          >
            {/* Header */}
            <div className="flex items-start gap-2">
              <div className={`flex-1 min-w-0 ${isRead ? "" : "font-medium"}`}>
                <span className="flex items-baseline gap-2 flex-wrap">
                  {item.feedTitle && (
                    <span className={`text-xs rounded px-1.5 py-0.5 ${feedTagColor(item.feedTitle)}`}>
                      {item.feedTitle}
                    </span>
                  )}
                  <span className="text-foreground">{item.title}</span>
                  {parsed && (
                    <span className="text-xs text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                      {formatDateShort(parsed)}
                    </span>
                  )}
                </span>
              </div>
              <span
                className={`shrink-0 text-xs rounded px-1.5 py-0.5 ${
                  isRead
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary"
                }`}
              >
                {isRead ? "read" : "new"}
              </span>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Original
                </a>
              )}
              {meta.urls.map((u, ui) => (
                <a
                  key={ui}
                  href={u.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {u.key}
                </a>
              ))}
              {itemAction && onAction && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(itemAction(item, i));
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  AI Summary
                </button>
              )}
              {item.summary && !meta.isMetadataOnly && (
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 transition-colors ${
                    isExpanded
                      ? "text-foreground bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <FileText className="h-3 w-3" />
                  Summary
                </button>
              )}
              {meta.stats.map((s, si) => (
                <span
                  key={si}
                  className="inline-flex items-center gap-1 text-xs bg-muted/60 text-muted-foreground rounded px-2 py-1"
                >
                  {s.key}:{" "}
                  <span className="font-medium">{s.value}</span>
                </span>
              ))}
            </div>

            {/* Summary — expanded */}
            {isExpanded && item.summary && !meta.isMetadataOnly && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-sm text-muted-foreground">{item.summary}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
