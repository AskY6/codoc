"use client";

import { useChatParticipants } from "@/workspace/hooks/use-session";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/utils";
import { Bot, Eye, MessageSquare } from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  "codoc-agent": "bg-blue-500",
  "summary-agent": "bg-violet-500",
  "info-check-agent": "bg-amber-500",
  "polish-agent": "bg-emerald-500",
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  "codoc-agent": "Manages codoc CRUD operations",
  "summary-agent": "Structured summarization",
  "info-check-agent": "Validates consistency",
  "polish-agent": "Text refinement",
};

interface ParticipantsPanelProps {
  onMentionAgent?: (agentId: string) => void;
}

export function ParticipantsPanel({ onMentionAgent }: ParticipantsPanelProps) {
  const participants = useChatParticipants();

  const agents = participants.filter((p) => p.kind === "agent");

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-4 pb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Participants
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-2 space-y-0.5">
          {agents.map((agent) => {
            const color = AGENT_COLORS[agent.id] ?? "bg-muted-foreground";
            const desc =
              AGENT_DESCRIPTIONS[agent.id] ?? agent.description;
            // Infer mode from the participant config hint in the name
            const isDaemon = agent.id === "codoc-agent";

            return (
              <button
                key={agent.id}
                onClick={() => onMentionAgent?.(agent.id)}
                className="w-full text-left rounded-md px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-sidebar-accent/60 group"
              >
                <div
                  className={cn(
                    "h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
                    color,
                  )}
                >
                  <Bot className="h-3.5 w-3.5 text-white" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-sidebar-foreground truncate">
                      {agent.name}
                    </span>
                    {isDaemon && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Eye className="h-2.5 w-2.5" />
                        daemon
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {desc}
                  </p>
                </div>

                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors mt-1 flex-shrink-0" />
              </button>
            );
          })}

          {agents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground gap-3">
              <Bot className="h-8 w-8 opacity-30" />
              <p className="text-xs text-center">No agents registered</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Backward compat
export function AgentsPanel() {
  return <ParticipantsPanel />;
}
