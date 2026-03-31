"use client";

import { useChatParticipants } from "@/workspace/hooks/use-session";
import {
  useSceneAgents,
  activateSceneAgent,
  deactivateSceneAgent,
  setSceneAgentTrust,
} from "@/workspace/hooks/use-scene-agents";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import { Bot, Eye, MessageSquare, Power, Shield, ShieldOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";

const AGENT_COLORS: Record<string, string> = {
  "cobook-assistant": "bg-blue-500",
  "codoc-agent": "bg-blue-500",
  "claude-log": "bg-violet-500",
};

interface ParticipantsPanelProps {
  onMentionAgent?: (agentId: string) => void;
}

export function ParticipantsPanel({ onMentionAgent }: ParticipantsPanelProps) {
  const participants = useChatParticipants();
  const sceneAgents = useSceneAgents();

  const chatAgents = participants.filter((p) => p.kind === "agent");

  return (
    <div className="flex flex-col h-full">
      {/* Infrastructure Agent (always on) */}
      <div className="px-3 pt-4 pb-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Infrastructure
        </h2>
      </div>

      <div className="px-1.5 pb-2">
        {chatAgents
          .filter((a) => a.id === "cobook-assistant")
          .map((agent) => (
            <button
              key={agent.id}
              onClick={() => onMentionAgent?.(agent.id)}
              className="w-full text-left rounded-md px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-sidebar-accent/60 group"
            >
              <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5", AGENT_COLORS[agent.id] ?? "bg-muted-foreground")}>
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {agent.name}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
                    <Eye className="h-2.5 w-2.5" />
                    always on
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {agent.description}
                </p>
              </div>
            </button>
          ))}
      </div>

      {/* Scene Agents */}
      <div className="px-3 pt-2 pb-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Scene Agents
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-2 space-y-0.5">
          {sceneAgents.length > 0
            ? sceneAgents.map((agent) => {
                const color = AGENT_COLORS[agent.id] ?? "bg-muted-foreground";
                return (
                  <div
                    key={agent.id}
                    className="rounded-md px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-sidebar-accent/60 group"
                  >
                    <div
                      className={cn(
                        "h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
                        agent.active ? color : "bg-muted-foreground/40",
                      )}
                    >
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-sm font-medium truncate",
                            agent.active
                              ? "text-sidebar-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {agent.name}
                        </span>
                        {agent.trusted && (
                          <span className="flex items-center gap-0.5 text-[10px] text-emerald-500">
                            <Shield className="h-2.5 w-2.5" />
                            trusted
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {agent.description}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-0.5 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Activate / Deactivate */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() =>
                              agent.active
                                ? deactivateSceneAgent(agent.id)
                                : activateSceneAgent(agent.id)
                            }
                          >
                            <Power
                              className={cn(
                                "h-3 w-3",
                                agent.active ? "text-emerald-500" : "text-muted-foreground",
                              )}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {agent.active ? "Deactivate" : "Activate"}
                        </TooltipContent>
                      </Tooltip>

                      {/* Trust toggle */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setSceneAgentTrust(agent.id, !agent.trusted)}
                          >
                            {agent.trusted ? (
                              <Shield className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <ShieldOff className="h-3 w-3 text-muted-foreground" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {agent.trusted ? "Revoke trust" : "Mark as trusted"}
                        </TooltipContent>
                      </Tooltip>

                      {/* Mention in chat */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => onMentionAgent?.(agent.id)}
                          >
                            <MessageSquare className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Mention in chat</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })
            // Fallback: show legacy chat agents if no scene agents are loaded yet
            : chatAgents
                .filter((a) => a.id !== "cobook-assistant")
                .map((agent) => {
                  const color = AGENT_COLORS[agent.id] ?? "bg-muted-foreground";
                  return (
                    <button
                      key={agent.id}
                      onClick={() => onMentionAgent?.(agent.id)}
                      className="w-full text-left rounded-md px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-sidebar-accent/60 group"
                    >
                      <div className={cn("h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5", color)}>
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-sidebar-foreground truncate">
                            {agent.name}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {agent.description}
                        </p>
                      </div>
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors mt-1 flex-shrink-0" />
                    </button>
                  );
                })}

          {sceneAgents.length === 0 && chatAgents.filter((a) => a.id !== "cobook-assistant").length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground gap-3">
              <Bot className="h-8 w-8 opacity-30" />
              <p className="text-xs text-center">No scene agents registered</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function AgentsPanel() {
  return <ParticipantsPanel />;
}
