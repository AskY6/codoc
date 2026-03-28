"use client";

import { PRESET_AGENTS } from "@/lib/agents";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, ShieldCheck, Sparkles, Bot } from "lucide-react";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  ShieldCheck,
  Sparkles,
};

interface AgentsPanelProps {
  onInvokeAgent: (agentId: string) => void;
}

export function AgentsPanel({ onInvokeAgent }: AgentsPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-4 pb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Agents
        </h2>
      </div>

      {/* Agent list */}
      <ScrollArea className="flex-1">
        <div className="px-3 pb-3 space-y-1.5">
          {PRESET_AGENTS.map((agent) => {
            const Icon = iconMap[agent.icon] ?? Bot;
            return (
              <button
                key={agent.id}
                onClick={() => onInvokeAgent(agent.id)}
                className="w-full text-left rounded-lg border border-sidebar-border bg-background p-3 hover:border-foreground/20 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {agent.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                      {agent.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
