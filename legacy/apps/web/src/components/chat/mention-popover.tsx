import { useEffect, useRef, useMemo } from "react";
import { Bot, FileText } from "lucide-react";
import type { AgentInfo, CodocListItem } from "@/types.js";

export interface MentionItem {
  kind: "agent" | "codoc";
  id: string;
  /** Display label inserted into the textarea */
  label: string;
  /** Display name shown in the popover */
  displayName: string;
  /** Secondary text (description for agents, path for titled codocs) */
  secondary?: string | undefined;
}

interface Props {
  open: boolean;
  /** Pre-filtered mention items (from useMentionItems) */
  items: MentionItem[];
  /** Index of the currently highlighted item (controlled by parent) */
  activeIndex: number;
  onSelect: (item: MentionItem) => void;
}

export function useMentionItems(
  agents: AgentInfo[],
  codocs: CodocListItem[],
  query: string,
): MentionItem[] {
  return useMemo(() => {
    const q = query.toLowerCase();
    const matchedAgents: MentionItem[] = agents
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q),
      )
      .map((a) => ({
        kind: "agent",
        id: a.id,
        label: a.name,
        displayName: a.name,
        secondary: a.description,
      }));
    const matchedCodocs: MentionItem[] = codocs
      .filter(
        (c) =>
          c.path.toLowerCase().includes(q) ||
          (c.meta.title ?? "").toLowerCase().includes(q),
      )
      .map((c) => ({
        kind: "codoc",
        id: c.id,
        label: c.path,
        displayName: c.meta.title ?? c.path,
        secondary: c.meta.title ? c.path : undefined,
      }));
    return [...matchedAgents, ...matchedCodocs];
  }, [agents, codocs, query]);
}

export function MentionPopover({
  open,
  items,
  activeIndex,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll active item into view
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!open) return null;

  const agentItems = items.filter((i) => i.kind === "agent");
  const codocItems = items.filter((i) => i.kind === "codoc");
  const empty = items.length === 0;

  // Track global index across both groups for keyboard navigation
  let idx = 0;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 z-50 rounded-lg border border-border bg-popover p-1 shadow-md">
      <div
        ref={listRef}
        className="max-h-56 overflow-y-auto overflow-x-hidden"
      >
        {empty && (
          <div className="py-3 text-center text-xs text-muted-foreground">
            No matches
          </div>
        )}

        {agentItems.length > 0 && (
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Agents
          </div>
        )}
        {agentItems.map((item) => {
          const isCurrent = idx === activeIndex;
          idx++;
          return (
            <button
              key={`agent:${item.id}`}
              data-active={isCurrent}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                onSelect(item);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                isCurrent
                  ? "bg-muted text-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{item.displayName}</div>
                {item.secondary && (
                  <div className="text-xs text-muted-foreground truncate">
                    {item.secondary}
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {codocItems.length > 0 && (
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Codocs
          </div>
        )}
        {codocItems.map((item) => {
          const isCurrent = idx === activeIndex;
          idx++;
          return (
            <button
              key={`codoc:${item.id}`}
              data-active={isCurrent}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                isCurrent
                  ? "bg-muted text-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{item.displayName}</div>
                {item.secondary && (
                  <div className="text-xs text-muted-foreground truncate">
                    {item.secondary}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
