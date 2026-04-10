import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, MessageSquare } from "lucide-react";
import type { ChatThread } from "@/types.js";

interface Props {
  threads: ChatThread[];
  activeThread: ChatThread | null;
  onSelect: (thread: ChatThread) => void;
  onNewThread: () => void;
}

export function ThreadSelector({ threads, activeThread, onSelect, onNewThread }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1 text-sm font-normal max-w-[200px]" />}>
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {activeThread?.title ?? "New chat"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={onNewThread}>
          <Plus className="h-4 w-4 mr-2" />
          New thread
        </DropdownMenuItem>
        {threads.length > 0 && <DropdownMenuSeparator />}
        {threads.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => onSelect(t)}
            className={t.id === activeThread?.id ? "bg-accent" : ""}
          >
            <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
            <span className="truncate">{t.title ?? "Untitled"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
