"use client";

import { ScrollArea } from "@/shared/ui/scroll-area";
import { Bot } from "lucide-react";

export function AgentsPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-4 pb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Agents
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground gap-3">
          <Bot className="h-8 w-8 opacity-30" />
          <p className="text-xs text-center">
            Agent system is being rebuilt. Check back after Phase 4.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
