import { Bot } from "lucide-react";
import { agentColor } from "@/lib/utils.js";
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
    <div className="flex items-center gap-1">
      {agents.map((a) => {
        const active = selectedIds.includes(a.id);
        const color = agentColor(a.id);
        return (
          <button
            key={a.id}
            onClick={() => toggle(a.id)}
            title={a.description}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              active
                ? `${color.bg} ${color.text}`
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? color.dot : "bg-current opacity-40"}`} />
            <span className="truncate max-w-24">{a.name}</span>
          </button>
        );
      })}
    </div>
  );
}
