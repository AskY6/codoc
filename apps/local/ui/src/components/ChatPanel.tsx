import { useState, useRef, useEffect, useCallback } from "react";
import { streamChat } from "../api.ts";
import type { ChatEvent } from "../api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; status: "running" | "done" }
  | { role: "error"; text: string };

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  /** Currently focused codoc path, if any */
  activeCodoc: string | null;
}

export function ChatPanel({ activeCodoc }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    const abort = new AbortController();
    abortRef.current = abort;

    let assistantText = "";

    try {
      for await (const evt of streamChat(text, sessionId, activeCodoc ?? undefined, abort.signal)) {
        handleEvent(evt, assistantText, (updated) => {
          assistantText = updated;
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "error", text: err instanceof Error ? err.message : String(err) },
        ]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, sessionId, activeCodoc]);

  function handleEvent(
    evt: ChatEvent,
    currentText: string,
    setText: (t: string) => void,
  ) {
    switch (evt.kind) {
      case "init":
        setSessionId(evt.sessionId);
        break;

      case "text": {
        const next = currentText + evt.text;
        setText(next);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { role: "assistant", text: next }];
          }
          return [...prev, { role: "assistant", text: next }];
        });
        break;
      }

      case "tool_use":
        setMessages((prev) => [
          ...prev,
          { role: "tool", name: evt.name, status: "running" },
        ]);
        break;

      case "tool_result":
        setMessages((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i]!;
            if (m.role === "tool" && m.name === evt.name && m.status === "running") {
              idx = i;
              break;
            }
          }
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { role: "tool", name: evt.name, status: "done" };
            return copy;
          }
          return prev;
        });
        break;

      case "done":
        // Final result — if there's a result text and no assistant text yet, show it
        if (evt.result && !currentText) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: evt.result! },
          ]);
        }
        break;

      case "error":
        setMessages((prev) => [
          ...prev,
          { role: "error", text: evt.message },
        ]);
        break;
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-6">
        <div className="flex items-center gap-2">
          <ChatIcon className="text-blue-500" />
          <h2 className="text-base font-semibold text-neutral-800">Chat</h2>
          {activeCodoc && (
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-medium text-blue-600">
              {activeCodoc}
            </span>
          )}
        </div>
        {sessionId && (
          <button
            type="button"
            className="text-xs text-neutral-400 hover:text-neutral-600"
            onClick={() => {
              setMessages([]);
              setSessionId(undefined);
            }}
          >
            New session
          </button>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <ChatIcon className="h-10 w-10 mb-3 text-neutral-200" />
            <p className="text-sm font-medium">Ask anything about your codocs</p>
            <p className="mt-1 text-xs opacity-60">
              Powered by Claude Code &mdash; uses codoc MCP tools
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Spinner />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-200 bg-neutral-50/50 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude to read, update, or create codocs..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {loading ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm text-white">
            {message.text}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-neutral-100 px-4 py-2.5 text-sm text-neutral-800 whitespace-pre-wrap">
            {message.text}
          </div>
        </div>
      );

    case "tool":
      return (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-1.5 text-xs text-amber-700">
          {message.status === "running" ? <Spinner /> : <CheckIcon />}
          <span className="font-mono">{message.name}</span>
        </div>
      );

    case "error":
      return (
        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-2.5 text-sm text-red-700">
          {message.text}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin text-current">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
