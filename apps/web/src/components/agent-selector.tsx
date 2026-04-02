import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import type { AgentInfo } from "@/types.js";

interface Props {
  agents: AgentInfo[];
  selectedIds: string[];
  onChange: (agentIds: string[]) => void;
}

export function AgentSelector({ agents, selectedIds, onChange }: Props) {
  function toggle(agentId: string) {
    if (selectedIds.includes(agentId)) {
      onChange(selectedIds.filter((id) => id !== agentId));
    } else {
      onChange([...selectedIds, agentId]);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1 text-sm">
            <Bot className="h-4 w-4" />
            <span>Agents</span>
            {selectedIds.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                {selectedIds.length}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56 p-1">
        {agents.map((a) => {
          const checked = selectedIds.includes(a.id);
          return (
            <button
              key={a.id}
              onClick={() => toggle(a.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
                checked
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="h-3.5 w-3.5 shrink-0"
              />
              <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{a.id}</span>
            </button>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
