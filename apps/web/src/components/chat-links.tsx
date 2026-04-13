import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ThreadListItem } from "../types";
import { relativeTime } from "../lib/format";
import { Button } from "./ui/button";

export function ChatLinks({
  threads,
  workspaceId,
  onNew,
  onDelete,
  creating,
}: {
  threads: readonly ThreadListItem[];
  workspaceId: string;
  onNew: () => void;
  onDelete: (id: string) => void;
  creating: boolean;
}) {
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Chats
        </h2>
        <Button size="sm" variant="ghost" onClick={onNew} disabled={creating}>
          <Plus className="h-3.5 w-3.5" />
          {creating ? "Creating…" : "New"}
        </Button>
      </div>

      {sorted.length > 0 ? (
        <div className="rounded-lg border border-border">
          {sorted.map((item) => (
            <div key={item.thread.id} className="group relative">
              <Link
                to={`/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(item.thread.id)}`}
                className="flex items-center gap-1.5 py-1.5 px-3 transition-colors hover:bg-muted/50"
              >
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
                <span className="truncate text-sm font-medium text-foreground">
                  {item.thread.title ?? "Untitled"}
                </span>
                <span className="ml-auto mr-7 text-[11px] text-muted-foreground/50 shrink-0">
                  {relativeTime(item.updatedAt)}
                </span>
              </Link>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Delete ${item.thread.title ?? "Untitled"}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(item.thread.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border py-6 px-4">
          <MessageSquare className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          <p className="text-sm text-muted-foreground">No chats yet</p>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onNew} disabled={creating}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      )}
    </section>
  );
}
