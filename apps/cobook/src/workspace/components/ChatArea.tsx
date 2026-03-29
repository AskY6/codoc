"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/workspace/hooks/use-session";
import { MessageRow } from "./MessageRow";
import { ContextBar } from "./ContextBar";
import { ChatInput } from "./ChatInput";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Sparkles } from "lucide-react";

export function ChatArea() {
  const messages = useChatMessages();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full">
      <ContextBar />

      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 text-muted-foreground">
            <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-muted-foreground/60" />
            </div>
            <div className="text-center max-w-sm">
              <p className="text-base font-medium text-foreground">
                Start a conversation
              </p>
              <p className="text-sm mt-1.5 leading-relaxed">
                Type a message or use <kbd className="px-1 py-0.5 rounded border bg-muted text-xs font-mono">@</kbd> to mention an agent.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {messages.map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t bg-background">
        <ChatInput />
      </div>
    </div>
  );
}
