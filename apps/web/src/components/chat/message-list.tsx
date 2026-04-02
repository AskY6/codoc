import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import type { ChatMessage } from "@/types.js";

interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

interface StreamingState {
  text: string;
  toolCalls: ToolCall[];
}

interface Props {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  onSuggest?: (prompt: string) => void;
}

const SUGGESTIONS = [
  "What codocs are in this workspace?",
  "Summarize the current project",
  "Help me create a new codoc",
];

export function MessageList({ messages, streaming, onSuggest }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <ScrollArea className="flex-1">
      <div className="px-4 py-4 space-y-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="rounded-full bg-muted p-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Start a conversation with the assistant
            </p>
            {onSuggest && (
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => onSuggest(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {streaming && (
          <MessageBubble
            role="assistant"
            content={streaming.text}
            toolCalls={streaming.toolCalls}
            isStreaming
          />
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
