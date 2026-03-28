"use client";

import { useSyncExternalStore } from "react";
import { getStore } from "@/hooks/use-workspace";

interface ChangeFeedProps {
  onSelectDoc?: (docId: string) => void;
}

const statusColors: Record<string, string> = {
  resolved: "text-green-600",
  dirty: "text-amber-600",
  error: "text-destructive",
  pending: "text-blue-600",
  idle: "text-muted-foreground",
};

export function ChangeFeed({ onSelectDoc }: ChangeFeedProps) {
  const store = getStore();

  const events = useSyncExternalStore(
    (cb) => store.subscribeFeed(cb),
    () => store.getFeedEvents(),
    () => [],
  );

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No events yet
      </div>
    );
  }

  // Show most recent first
  const reversed = [...events].reverse();

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-2">
        <h2 className="text-sm font-medium">Change Feed</h2>
        <p className="text-xs text-muted-foreground">{events.length} events</p>
      </div>
      <div className="flex-1 overflow-auto">
        <ul className="divide-y">
          {reversed.map((event, i) => (
            <li
              key={`${event.ts}-${i}`}
              className="px-4 py-2 hover:bg-secondary/50 cursor-pointer transition-colors"
              onClick={() => onSelectDoc?.(event.docId)}
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${statusColors[event.status] ?? ""}`}>
                  {event.status}
                </span>
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {event.docId}:{event.path}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(event.ts).toLocaleTimeString()}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
