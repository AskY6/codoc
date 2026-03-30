"use client";

import type { ChatMessage } from "@/workspace/stores/api-client";
import { IntentCard } from "./IntentCard";
import { CodocCard } from "./CodocCard";
import { cn } from "@/shared/utils";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { User, Bot, Radio } from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  "codoc-agent": "bg-blue-500",
  "summary-agent": "bg-violet-500",
  "info-check-agent": "bg-amber-500",
  "polish-agent": "bg-emerald-500",
  system: "bg-muted-foreground",
};

function agentDisplayName(id: string): string {
  const names: Record<string, string> = {
    "codoc-agent": "Codoc",
    "summary-agent": "Summary",
    "info-check-agent": "Info Check",
    "polish-agent": "Polish",
    system: "System",
    user: "You",
  };
  return names[id] ?? id;
}

interface MessageRowProps {
  message: ChatMessage;
}

export function MessageRow({ message }: MessageRowProps) {
  const isHuman = message.sender.kind === "human";
  const isSystem = message.sender.id === "system";
  const displayName = agentDisplayName(message.sender.id);
  const avatarColor = AGENT_COLORS[message.sender.id] ?? "bg-primary";

  if (isSystem) {
    return (
      <div className="flex items-start gap-2 px-4 py-1.5">
        <Radio className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 px-4 py-3", isHuman && "bg-muted/30")}>
      <Avatar className="h-7 w-7 flex-shrink-0 mt-0.5">
        <AvatarFallback
          className={cn(
            "text-white text-[10px] font-semibold",
            isHuman ? "bg-foreground" : avatarColor,
          )}
        >
          {isHuman ? (
            <User className="h-3.5 w-3.5" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              isHuman ? "text-foreground" : "text-foreground/80",
            )}
          >
            {displayName}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {/* Resource cards */}
        {message.resourceRefs && message.resourceRefs.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {message.resourceRefs
              .filter((r) => r.kind === "codoc")
              .map((ref) => (
                <CodocCard key={ref.id} docId={ref.id} />
              ))}
          </div>
        )}

        {/* Intent cards */}
        {message.intents && message.intents.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {message.intents.map((intent, idx) => (
              <IntentCard
                key={idx}
                intent={intent}
                messageId={message.id}
                intentIdx={idx}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
