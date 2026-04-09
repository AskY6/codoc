import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  Wrench,
  User,
  Bot,
  FileText,
  Terminal,
  Search,
  FolderSearch,
  Pencil,
  FilePlus,
  Cpu,
} from "lucide-react";

interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
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

// ---------------------------------------------------------------------------
// Smart tool summary — one-line description per tool type
// ---------------------------------------------------------------------------

const toolIcons: Record<string, typeof Wrench> = {
  Read: FileText,
  Write: FilePlus,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderSearch,
  Agent: Cpu,
};

function toolSummary(call: ToolCall): string {
  const inp = call.input ?? {};
  switch (call.name) {
    case "Read":
      return shortPath(String(inp["file_path"] ?? ""));
    case "Write":
      return shortPath(String(inp["file_path"] ?? ""));
    case "Edit":
      return shortPath(String(inp["file_path"] ?? ""));
    case "Bash":
      return truncate(String(inp["command"] ?? ""), 80);
    case "Grep":
      return `/${inp["pattern"] ?? ""}/ ${inp["path"] ? "in " + shortPath(String(inp["path"])) : ""}`.trim();
    case "Glob":
      return String(inp["pattern"] ?? "");
    case "Agent": {
      const desc = inp["description"] ?? inp["prompt"];
      return truncate(String(desc ?? ""), 60);
    }
    default:
      return call.name;
  }
}

function shortPath(p: string): string {
  // Keep last 3 segments
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return "…/" + parts.slice(-3).join("/");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

// ---------------------------------------------------------------------------
// Message content with collapsing
// ---------------------------------------------------------------------------

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
      <div className="text-sm prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-hr:my-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
      </div>
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

// ---------------------------------------------------------------------------
// Tool call badge with smart summary + expandable result
// ---------------------------------------------------------------------------

function ToolCallBadge({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcons[call.name] ?? Wrench;
  const summary = toolSummary(call);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 bg-muted/60 hover:bg-muted transition-colors max-w-full"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Icon className="h-3 w-3 shrink-0" />
        <span className="font-medium shrink-0">{call.name}</span>
        <span className="truncate opacity-70">{summary}</span>
      </button>
      {open && (
        <div className="mt-1 ml-6 space-y-1">
          {call.input && (
            <pre className="text-xs text-muted-foreground bg-muted/40 rounded p-2 overflow-auto max-h-32">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          )}
          {call.result && (
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Result
              </summary>
              <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-2 overflow-auto max-h-48 mt-1">
                {call.result}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merged tool group — when multiple tool calls have no text
// ---------------------------------------------------------------------------

function ToolGroup({ calls }: { calls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  if (calls.length <= 3) {
    return (
      <>
        {calls.map((tc, i) => (
          <ToolCallBadge key={i} call={tc} />
        ))}
      </>
    );
  }

  // Summarize: "6 tool calls (Read ×4, Write ×1, Edit ×1)"
  const counts = new Map<string, number>();
  for (const tc of calls) {
    counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
  }
  const summary = Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 bg-muted/60 hover:bg-muted transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Wrench className="h-3 w-3 shrink-0" />
        <span>
          {calls.length} tool calls ({summary})
        </span>
      </button>
      {expanded && (
        <div className="ml-4 mt-1">
          {calls.map((tc, i) => (
            <ToolCallBadge key={i} call={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main Conversation component
// ---------------------------------------------------------------------------

export function Conversation({ messages }: ConversationProps) {
  let lastDate = "";

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => {
        const isUser = msg.role === "user";
        const hasText = msg.content.trim().length > 0;
        const hasTools = (msg.toolCalls?.length ?? 0) > 0;

        // Date separator
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
              {hasText && <MessageContent text={msg.content} />}
              {hasTools &&
                (hasText ? (
                  // Text + tools: show individually
                  msg.toolCalls!.map((tc, ti) => (
                    <ToolCallBadge key={ti} call={tc} />
                  ))
                ) : (
                  // Tool-only message: use grouped rendering
                  <ToolGroup calls={msg.toolCalls!} />
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
