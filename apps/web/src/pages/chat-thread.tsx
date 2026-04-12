// Chat thread page.
//
// Slice 5b surface: full chat with SSE-streamed agent turns. Header
// shows thread title, agent picker, and codoc context picker. Transcript
// renders both user and assistant messages with real-time token
// streaming from the SSE transport.
//
// Data flow:
//   1. Single `getThread` query hydrates the page (page-bundle DTO).
//   2. Send triggers `runAgentTurnStream` which opens an SSE connection.
//      Tokens accumulate in local state as an optimistic assistant
//      message; on `done` the thread detail query is invalidated and
//      the canonical messages from the server replace the optimistic one.
//   3. Agent/codoc pickers call set* endpoints and invalidate.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  Square,
  User,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { listAgents } from "../api/agents";
import { listCodocsByWorkspace } from "../api/codocs";
import { runAgentTurnStream, type StreamControl } from "../api/sse";
import {
  getThread,
  setThreadAgents,
  setThreadCodocs,
} from "../api/threads";
import { CodocCard } from "../components/codoc-card";
import { CodocPanel } from "../components/codoc-panel";
import { Button } from "../components/ui/button";
import { relativeTime } from "../lib/format";
import type {
  AgentListItem,
  ChatMessage,
  CodocListItem,
  SSEToolCallEvent,
  ThreadMessage,
  ToolCall,
} from "../types";

// ---- Codoc reference extraction from tool calls ----------------------------

const CODOC_ID_TOOLS = new Set(["getCodoc", "updateCodoc", "deleteCodoc"]);

function extractCodocIds(toolCalls: readonly ToolCall[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const tc of toolCalls) {
    if (CODOC_ID_TOOLS.has(tc.name)) {
      const id = (tc.input as { id?: string }).id;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

const threadKey = (id: string) => ["thread", id] as const;
const agentsKey = ["agents"] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;

// ---- Tool call display (collapsed by default) ---------------------------

function ToolCallIndicator({ toolCalls }: { toolCalls: readonly ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="h-3 w-3" />
        {toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {toolCalls.map((tc, i) => (
            <li
              key={i}
              className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
            >
              {tc.name}({JSON.stringify(tc.input)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Message bubble -----------------------------------------------------

function MessageBubble({
  item,
  agentName,
  codocLookup,
  selectedCodocId,
  onSelectCodoc,
}: {
  item: ThreadMessage;
  agentName: string | null;
  codocLookup: ReadonlyMap<string, CodocListItem>;
  selectedCodocId: string | null;
  onSelectCodoc: (id: string) => void;
}) {
  const msg: ChatMessage = item.message;

  if (msg.kind === "user") {
    return (
      <li className="flex flex-col items-end">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <User className="h-3 w-3" />
          You
        </span>
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-secondary px-4 py-2.5 text-sm text-foreground">
          {msg.content}
        </div>
      </li>
    );
  }

  if (msg.kind === "assistant") {
    const codocIds = extractCodocIds(msg.metadata.toolCalls);
    return (
      <li className="flex flex-col items-start">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Bot className="h-3 w-3" />
          {agentName ?? msg.agentId}
        </span>
        <div className="max-w-[80%] whitespace-pre-wrap text-sm text-foreground">
          {msg.content}
          <ToolCallIndicator toolCalls={msg.metadata.toolCalls} />
        </div>
        {codocIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {codocIds.map((id) => {
              const codoc = codocLookup.get(id);
              return (
                <CodocCard
                  key={id}
                  codocId={id}
                  title={codoc?.title ?? null}
                  path={codoc?.path ?? id}
                  isSelected={selectedCodocId === id}
                  onClick={onSelectCodoc}
                />
              );
            })}
          </div>
        )}
      </li>
    );
  }

  // system
  return (
    <li className="flex justify-center">
      <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {msg.content}
      </div>
    </li>
  );
}

// ---- Streaming assistant bubble (optimistic, in-progress) ---------------

function StreamingBubble({
  text,
  toolCalls,
  agentName,
}: {
  text: string;
  toolCalls: readonly SSEToolCallEvent[];
  agentName: string | null;
}) {
  return (
    <li className="flex flex-col items-start">
      <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="h-3 w-3" />
        {agentName ?? "Assistant"}
      </span>
      <div className="max-w-[80%] whitespace-pre-wrap text-sm text-foreground">
        {text || (
          <span className="inline-flex items-center gap-1 text-muted-foreground animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" />
            Thinking...
          </span>
        )}
        {toolCalls.length > 0 && (
          <div className="mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Wrench className="h-3 w-3" />
              {toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

// ---- Agent picker (multi-select toggle) ---------------------------------

function AgentPicker({
  threadId,
  currentAgentIds,
  allAgents,
}: {
  threadId: string;
  currentAgentIds: readonly string[];
  allAgents: readonly AgentListItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(agentId: string) {
    const current = new Set(currentAgentIds);
    if (current.has(agentId)) {
      current.delete(agentId);
    } else {
      current.add(agentId);
    }
    setPending(true);
    setThreadAgents({ threadId, agentIds: [...current] })
      .then(() => queryClient.invalidateQueries({ queryKey: threadKey(threadId) }))
      .finally(() => setPending(false));
  }

  if (allAgents.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bot className="h-3 w-3" />
        Agents ({currentAgentIds.length})
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-border bg-background p-1 shadow-lg">
          {allAgents.map((a) => {
            const checked = currentAgentIds.includes(a.listing.id);
            return (
              <label
                key={a.listing.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(a.listing.id)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span className="flex-1 truncate text-foreground">{a.listing.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Codoc context picker -----------------------------------------------

function CodocPicker({
  threadId,
  currentCodocIds,
  allCodocs,
}: {
  threadId: string;
  currentCodocIds: readonly string[];
  allCodocs: readonly CodocListItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(codocId: string) {
    const current = new Set(currentCodocIds);
    if (current.has(codocId)) {
      current.delete(codocId);
    } else {
      current.add(codocId);
    }
    setPending(true);
    setThreadCodocs({ threadId, codocIds: [...current] })
      .then(() => queryClient.invalidateQueries({ queryKey: threadKey(threadId) }))
      .finally(() => setPending(false));
  }

  if (allCodocs.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3" />
        Codocs ({currentCodocIds.length})
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-border bg-background p-1 shadow-lg">
          {allCodocs.map((c) => {
            const checked = currentCodocIds.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span className="flex-1 truncate text-foreground">
                  {c.title ?? c.path}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Page ---------------------------------------------------------------

export function ChatThreadPage() {
  const { workspaceId: wsParam, threadId: threadParam } = useParams<{
    workspaceId: string;
    threadId: string;
  }>();
  const workspaceId = wsParam ?? "";
  const threadId = threadParam ?? "";
  const queryClient = useQueryClient();

  const threadQuery = useQuery({
    queryKey: threadKey(threadId),
    queryFn: () => getThread(threadId),
    enabled: threadId !== "",
  });

  const agentsQuery = useQuery({
    queryKey: agentsKey,
    queryFn: listAgents,
  });

  const codocsQuery = useQuery({
    queryKey: codocListKey(workspaceId),
    queryFn: () => listCodocsByWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const [draft, setDraft] = useState("");
  const [selectedCodocId, setSelectedCodocId] = useState<string | null>(null);

  // ---- Streaming state --------------------------------------------------

  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamToolCalls, setStreamToolCalls] = useState<SSEToolCallEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const streamRef = useRef<StreamControl | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [
    threadQuery.data?.messages.length,
    streamText,
    streaming,
    optimisticUserMsg,
  ]);

  const handleSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || streaming) return;

      setDraft("");
      setStreaming(true);
      setStreamText("");
      setStreamToolCalls([]);
      setStreamError(null);
      setOptimisticUserMsg(trimmed);

      streamRef.current = runAgentTurnStream(threadId, trimmed, {
        onToken: (event) => {
          setStreamText((prev) => prev + event.delta);
        },
        onToolCall: (event) => {
          setStreamToolCalls((prev) => [...prev, event]);
        },
        onDone: () => {
          setStreaming(false);
          setStreamText("");
          setStreamToolCalls([]);
          setOptimisticUserMsg(null);
          streamRef.current = null;
          void queryClient.invalidateQueries({
            queryKey: threadKey(threadId),
          });
        },
        onTitleUpdate: () => {
          void queryClient.invalidateQueries({
            queryKey: threadKey(threadId),
          });
        },
        onError: (event) => {
          setStreamError(event.message);
          setStreaming(false);
          setOptimisticUserMsg(null);
          streamRef.current = null;
          // Still invalidate to pick up any persisted messages.
          void queryClient.invalidateQueries({
            queryKey: threadKey(threadId),
          });
        },
      });
    },
    [draft, streaming, threadId, queryClient],
  );

  function handleStop() {
    streamRef.current?.abort();
    setStreaming(false);
    setStreamText("");
    setStreamToolCalls([]);
    setOptimisticUserMsg(null);
    streamRef.current = null;
    void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as FormEvent);
    }
  }

  // Clean up stream on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  // Build agent id -> name map for display.
  const agentNameMap = new Map<string, string>();
  for (const a of agentsQuery.data ?? []) {
    agentNameMap.set(a.listing.id, a.listing.name);
  }

  // Build codoc id -> list item map for card display.
  const codocLookup = new Map<string, CodocListItem>();
  for (const c of codocsQuery.data ?? []) {
    codocLookup.set(c.id, c);
  }

  if (threadQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (threadQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          to={`/workspace/${encodeURIComponent(workspaceId)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to workspace
        </Link>
        <p className="mt-6 text-sm text-destructive">
          Failed to load chat: {(threadQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const detail = threadQuery.data;
  if (!detail) return null;

  return (
    <div className="flex h-screen">
      {/* ---- Left column: chat ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
          <Link
            to={`/workspace/${encodeURIComponent(workspaceId)}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to workspace
          </Link>

          <header className="mt-6 mb-4">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {detail.thread.thread.title ?? "Untitled"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Last edited {relativeTime(detail.thread.updatedAt)}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <AgentPicker
                threadId={threadId}
                currentAgentIds={detail.agentIds}
                allAgents={agentsQuery.data ?? []}
              />
              <CodocPicker
                threadId={threadId}
                currentCodocIds={detail.codocIds}
                allCodocs={codocsQuery.data ?? []}
              />
            </div>
          </header>

          <div
            ref={scrollRef}
            className="mb-4 flex-1 overflow-y-auto p-4"
          >
            {detail.messages.length === 0 && !optimisticUserMsg ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  No messages yet. Say something to start the conversation.
                </p>
              </div>
            ) : (
              <ul className="space-y-6">
                {detail.messages.map((item) => (
                  <MessageBubble
                    key={item.message.id}
                    item={item}
                    agentName={
                      item.message.kind === "assistant"
                        ? agentNameMap.get(item.message.agentId) ?? null
                        : null
                    }
                    codocLookup={codocLookup}
                    selectedCodocId={selectedCodocId}
                    onSelectCodoc={setSelectedCodocId}
                  />
                ))}
                {optimisticUserMsg && (
                  <li className="flex flex-col items-end">
                    <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      You
                    </span>
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-secondary px-4 py-2.5 text-sm text-foreground">
                      {optimisticUserMsg}
                    </div>
                  </li>
                )}
                {streaming && (
                  <StreamingBubble
                    text={streamText}
                    toolCalls={streamToolCalls}
                    agentName={null}
                  />
                )}
              </ul>
            )}
          </div>

          <form onSubmit={handleSend} className="flex items-end gap-2 pb-4">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:opacity-50"
            />
            {streaming ? (
              <Button type="button" onClick={handleStop} variant="outline">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={draft.trim() === ""}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </form>
          {streamError && (
            <p className="pb-4 text-sm text-destructive">{streamError}</p>
          )}
        </div>
      </div>

      {/* ---- Right column: codoc panel ---- */}
      {selectedCodocId && (
        <div className="w-[480px] shrink-0">
          <CodocPanel
            codocId={selectedCodocId}
            onClose={() => setSelectedCodocId(null)}
          />
        </div>
      )}
    </div>
  );
}

