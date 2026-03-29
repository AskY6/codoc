"use client";

import { Sparkles } from "lucide-react";

export function ChatPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-muted-foreground/60" />
        </div>
        <div className="text-center max-w-sm">
          <p className="text-base font-medium text-foreground">
            Chat is being rebuilt
          </p>
          <p className="text-sm mt-1.5 leading-relaxed">
            The chat system is being reconstructed with the new Chat Ability
            architecture. It will be available after Phase 5.
          </p>
        </div>
      </div>
    </div>
  );
}
