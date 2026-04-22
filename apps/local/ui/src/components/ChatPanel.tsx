import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat } from "../api.ts";
import type { ChatEvent } from "../api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  status: "running" | "done";
  input?: Record<string, unknown>;
}

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "error"; text: string };

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  activeCodoc: string | null;
}

export function ChatPanel({ activeCodoc }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    let toolCalls: ToolCall[] = [];

    try {
      for await (const evt of streamChat(text, sessionId, activeCodoc ?? undefined, abort.signal)) {
        switch (evt.kind) {
          case "init":
            setSessionId(evt.sessionId);
            break;

          case "text": {
            assistantText += evt.text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { role: "assistant", text: assistantText, toolCalls }];
              }
              return [...prev, { role: "assistant", text: assistantText, toolCalls }];
            });
            break;
          }

          case "tool_use": {
            toolCalls = [...toolCalls, { name: evt.name, status: "running", input: evt.input }];
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { role: "assistant", text: assistantText, toolCalls }];
              }
              return [...prev, { role: "assistant", text: assistantText, toolCalls }];
            });
            break;
          }

          case "tool_result": {
            toolCalls = toolCalls.map((tc) =>
              tc.name === evt.name && tc.status === "running"
                ? { ...tc, status: "done" as const }
                : tc,
            );
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { role: "assistant", text: assistantText, toolCalls }];
              }
              return prev;
            });
            break;
          }

          case "done":
            if (evt.result && !assistantText) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", text: evt.result!, toolCalls },
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
        <div className="flex items-center gap-2">
          <ChatIcon className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-700">Chat</h2>
          {activeCodoc && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
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
      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        {isEmpty && (
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

        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500 animate-pulse">
              Thinking...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-200 bg-neutral-50/50 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Claude to read, update, or create codocs..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {loading ? (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
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
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
            {message.text}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[85%] space-y-2">
            {message.toolCalls.length > 0 && (
              <div className="space-y-1">
                {message.toolCalls.map((tc, i) => (
                  <ToolCallChip key={i} tc={tc} />
                ))}
              </div>
            )}
            {message.text && (
              <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5 text-sm prose prose-sm prose-neutral max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-pre:bg-neutral-800 prose-pre:text-neutral-100 prose-ul:my-1 prose-ol:my-1 prose-code:before:content-none prose-code:after:content-none">
                <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
              </div>
            )}
          </div>
        </div>
      );

    case "error":
      return (
        <div className="mx-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {message.text}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// ToolCallChip
// ---------------------------------------------------------------------------

function ToolCallChip({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <ToolIcon />
        <span className="font-mono">{tc.name}</span>
        {tc.status === "done" ? (
          <span className="text-green-600">done</span>
        ) : (
          <span className="text-neutral-400 animate-pulse">running</span>
        )}
      </button>
      {expanded && tc.input && (
        <pre className="mt-1 ml-4 rounded bg-neutral-100 p-2 text-xs text-neutral-500 overflow-x-auto">
          {JSON.stringify(tc.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
