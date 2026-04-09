import { useState, useCallback } from "react";
import { ChevronRight, Wrench, User, Bot } from "lucide-react";

interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  toolCalls?: ToolCall[];
}

interface ConversationProps {
  messages: Message[];
}

const MAX_COLLAPSED_LINES = 12;

function MessageContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsCollapse = lines.length > MAX_COLLAPSED_LINES;
  const display =
    needsCollapse && !expanded
      ? lines.slice(0, MAX_COLLAPSED_LINES).join("\n")
      : text;

  return (
    <div>
      <p className="text-sm whitespace-pre-wrap break-words">{display}</p>
      {needsCollapse && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-primary hover:underline mt-1"
        >
          Show {lines.length - MAX_COLLAPSED_LINES} more lines…
        </button>
      )}
    </div>
  );
}

function ToolCallBadge({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 bg-muted/60 hover:bg-muted transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Wrench className="h-3 w-3" />
        {call.name}
      </button>
      {open && call.input && (
        <pre className="mt-1 ml-6 text-xs text-muted-foreground bg-muted/40 rounded p-2 overflow-auto max-h-32">
          {JSON.stringify(call.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Conversation({ messages }: ConversationProps) {
  // Group consecutive messages and insert timestamp separators
  let lastDate = "";

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => {
        const isUser = msg.role === "user";
        let dateSep: string | null = null;
        if (msg.timestamp) {
          const d = new Date(msg.timestamp);
          const dateStr = d.toLocaleDateString();
          if (dateStr !== lastDate) {
            lastDate = dateStr;
            dateSep = d.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
          }
        }

        return (
          <div key={i}>
            {dateSep && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{dateSep}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <div
              className={`rounded-lg px-4 py-3 ${
                isUser
                  ? "bg-primary/5 border border-primary/10"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {isUser ? (
                  <User className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={`text-xs font-medium ${
                    isUser ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {isUser ? "User" : "Assistant"}
                </span>
                {msg.timestamp && (
                  <span className="text-xs text-muted-foreground/60 ml-auto">
                    {formatTime(msg.timestamp)}
                  </span>
                )}
              </div>
              <MessageContent text={msg.content} />
              {msg.toolCalls?.map((tc, ti) => (
                <ToolCallBadge key={ti} call={tc} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
