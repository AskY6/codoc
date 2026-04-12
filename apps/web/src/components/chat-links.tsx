import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ThreadListItem } from "../types";

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
  return (
    <section className="mb-6 pt-4 border-t border-border/50">
      <div className="mb-1.5 flex items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Chats
        </h2>
        <button
          type="button"
          onClick={onNew}
          disabled={creating}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {creating ? "Creating…" : "+ New"}
        </button>
      </div>

      {threads.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {threads.map((item) => (
            <div key={item.thread.id} className="group flex items-center gap-1">
              <Link
                to={`/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(item.thread.id)}`}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {item.thread.title ?? "Untitled"}
              </Link>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive"
                aria-label={`Delete ${item.thread.title ?? "Untitled"}`}
                onClick={() => onDelete(item.thread.id)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No chats yet —{" "}
          <button
            type="button"
            onClick={onNew}
            disabled={creating}
            className="underline hover:text-foreground transition-colors"
          >
            start one
          </button>
        </p>
      )}
    </section>
  );
}
