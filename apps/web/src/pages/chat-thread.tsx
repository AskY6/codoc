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
import { reconnectStream, runAgentTurnStream, type StreamControl } from "../api/sse";
import {
  confirmToolCall,
  getThread,
  setThreadAgents,
  setThreadCodocs,
} from "../api/threads";
import { ChatMarkdown } from "../components/chat-markdown";
import { CodocCard } from "../components/codoc-card";
import { CodocPanel } from "../components/codoc-panel";
import { ToolConfirmation } from "../components/tool-confirmation";
import { Button } from "../components/ui/button";
import { relativeTime } from "../lib/format";
import type {
  AgentListItem,
  ChatMessage,
  CodocListItem,
  SSEConfirmationRequestEvent,
  SSEToolCallEvent,
  SSEToolResultEvent,
  ThreadMessage,
  ToolCall,
  ToolResult,
} from "../types";

// ---- Codoc reference extraction from tool calls ----------------------------

const CONFIRMATION_TOOLS = new Set(["createCodoc", "updateCodoc", "deleteCodoc"]);

function extractCodocIds(
  toolCalls: readonly ToolCall[],
  toolResults: readonly ToolResult[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const tc of toolCalls) {
    if (tc.name === "updateCodoc") {
      const id = (tc.input as { id?: string }).id;
      if (id) push(id);
    }
  }
  for (const tr of toolResults) {
    if (tr.name === "createCodoc") {
      const id = (tr.output as { id?: string })?.id;
      if (id) push(id);
    }
  }
  return ids;
}

const threadKey = (id: string) => ["thread", id] as const;
const agentsKey = ["agents"] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;

// ---- Tool call + result cards --------------------------------------------

/** Build a name→output lookup from the results array. */
function buildResultMap(
  results: readonly ToolResult[],
): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (const r of results) {
    const arr = map.get(r.name);
    if (arr) arr.push(r.output);
    else map.set(r.name, [r.output]);
  }
  return map;
}

function ToolCallCards({
  toolCalls,
  toolResults,
}: {
  toolCalls: readonly ToolCall[];
  toolResults: readonly ToolResult[];
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (toolCalls.length === 0) return null;

  // Track per-name indices to pair calls with results in order.
  const resultMap = buildResultMap(toolResults);
  const consumed = new Map<string, number>();

  return (
    <div className="mt-2 space-y-0">
      {toolCalls.map((tc, i) => {
        // Pair this call with the next unconsumed result of the same name.
        const idx = consumed.get(tc.name) ?? 0;
        consumed.set(tc.name, idx + 1);
        const outputs = resultMap.get(tc.name);
        const result = outputs?.[idx];
        const isExpanded = expandedIdx === i;
        const isDenied = result != null && typeof result === "object" && (result as Record<string, unknown>).denied === true;

        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="flex items-center gap-1.5 py-0.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
            >
              <Wrench className="h-2.5 w-2.5 shrink-0" />
              <span>{tc.name}</span>
              {summarizeInput(tc.input) && (
                <span className="truncate max-w-[200px] opacity-60">
                  {summarizeInput(tc.input)}
                </span>
              )}
              {isDenied && (
                <span className="text-destructive/70">denied</span>
              )}
              {isExpanded ? (
                <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-40" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-40" />
              )}
            </button>
            {isExpanded && (
              <div className="ml-4 mt-1 mb-1 space-y-1.5">
                <div>
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                    Input
                  </p>
                  <pre className="overflow-x-auto rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
                    {JSON.stringify(tc.input, null, 2)}
                  </pre>
                </div>
                {result !== undefined && (
                  <div>
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                      Output
                    </p>
                    <pre className="max-h-48 overflow-auto rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground/70">
                      {typeof result === "string"
                        ? result
                        : JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One-line summary of tool input for the collapsed row. */
function summarizeInput(input: Readonly<Record<string, unknown>> | undefined): string {
  if (!input) return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  if (keys.length === 1) {
    const val = input[keys[0]!];
    const str = typeof val === "string" ? val : JSON.stringify(val);
    return str.length > 60 ? str.slice(0, 57) + "..." : str;
  }
  return keys.join(", ");
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
    const codocIds = extractCodocIds(msg.metadata.toolCalls, msg.metadata.toolResults ?? []);
    return (
      <li className="flex flex-col items-start">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Bot className="h-3 w-3" />
          {agentName ?? msg.agentId}
        </span>
        {msg.content && (
          <div className="max-w-[80%] text-sm text-foreground">
            <ChatMarkdown content={msg.content} />
          </div>
        )}
        <ToolCallCards
          toolCalls={msg.metadata.toolCalls}
          toolResults={msg.metadata.toolResults ?? []}
        />
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
  toolResults,
  confirmations,
  onConfirmRespond,
  agentName,
}: {
  text: string;
  toolCalls: readonly SSEToolCallEvent[];
  toolResults: readonly SSEToolResultEvent[];
  confirmations: readonly SSEConfirmationRequestEvent[];
  onConfirmRespond: (requestId: string, approved: boolean) => void;
  agentName: string | null;
}) {
  // Convert streaming SSE events into the ToolCall/ToolResult shapes
  // expected by ToolCallCards.
  const calls: ToolCall[] = toolCalls.map((tc) => ({
    name: tc.tool,
    input: tc.input,
  }));
  const results: ToolResult[] = toolResults.map((tr) => ({
    name: tr.tool,
    output: tr.output,
  }));

  return (
    <li className="flex flex-col items-start">
      <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="h-3 w-3" />
        {agentName ?? "Assistant"}
      </span>
      {text && (
        <div className="max-w-[80%] text-sm text-foreground">
          <ChatMarkdown content={text} />
        </div>
      )}
      <ToolCallCards toolCalls={calls} toolResults={results} />
      {confirmations.map((c) => (
        <div key={c.requestId} className="mt-2 w-full max-w-[80%]">
          <ToolConfirmation
            requestId={c.requestId}
            tool={c.tool}
            input={c.input}
            onRespond={onConfirmRespond}
          />
        </div>
      ))}
      <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
        <Loader2 className="h-3 w-3 animate-spin" />
        {toolCalls.length === 0 && !text ? "Thinking..." : "Processing..."}
      </span>
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
  const [streamToolResults, setStreamToolResults] = useState<SSEToolResultEvent[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<SSEConfirmationRequestEvent[]>([]);
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
    streamToolCalls.length,
    streamToolResults.length,
    pendingConfirmations.length,
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
      setStreamToolResults([]);
      setPendingConfirmations([]);
      setStreamError(null);
      setOptimisticUserMsg(trimmed);

      streamRef.current = runAgentTurnStream(threadId, trimmed, {
        onToken: (event) => {
          setStreamText((prev) => prev + event.delta);
        },
        onToolCall: (event) => {
          setStreamToolCalls((prev) => [...prev, event]);
        },
        onToolResult: (event) => {
          setStreamToolResults((prev) => [...prev, event]);
        },
        onConfirmationRequest: (event) => {
          setPendingConfirmations((prev) => [...prev, event]);
        },
        onDone: () => {
          setStreaming(false);
          setStreamText("");
          setStreamToolCalls([]);
          setStreamToolResults([]);
          setPendingConfirmations([]);
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
    setStreamToolResults([]);
    setPendingConfirmations([]);
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

  function handleConfirmRespond(requestId: string, approved: boolean) {
    confirmToolCall({ threadId, requestId, approved }).catch(() => {});
  }

  // Clean up stream on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  // Reconnect to in-progress stream on page load / refresh.
  // The server's GET /stream returns 204 if idle, or replays buffered
  // events and continues streaming if a turn is active.
  useEffect(() => {
    if (!threadId) return;

    const ctrl = reconnectStream(threadId, {
      onToken: (event) => {
        setStreaming(true);
        setStreamText((prev) => prev + event.delta);
      },
      onToolCall: (event) => {
        setStreaming(true);
        setStreamToolCalls((prev) => [...prev, event]);
      },
      onToolResult: (event) => {
        setStreaming(true);
        setStreamToolResults((prev) => [...prev, event]);
      },
      onConfirmationRequest: (event) => {
        setStreaming(true);
        setPendingConfirmations((prev) => [...prev, event]);
      },
      onDone: () => {
        setStreaming(false);
        setStreamText("");
        setStreamToolCalls([]);
        setStreamToolResults([]);
        setPendingConfirmations([]);
        setOptimisticUserMsg(null);
        streamRef.current = null;
        void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      },
      onTitleUpdate: () => {
        void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      },
      onError: (event) => {
        setStreamError(event.message);
        setStreaming(false);
        streamRef.current = null;
        void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      },
    });

    streamRef.current = ctrl;

    return () => ctrl.abort();
    // Only run once per thread mount — reconnect is a one-shot probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

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
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (threadQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
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
    <div className="flex h-screen overflow-hidden">
      {/* ---- Left column: chat ---- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 py-10">
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
                    toolResults={streamToolResults}
                    confirmations={pendingConfirmations}
                    onConfirmRespond={handleConfirmRespond}
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
        <div className="w-[480px] shrink-0 min-h-0">
          <CodocPanel
            codocId={selectedCodocId}
            onClose={() => setSelectedCodocId(null)}
          />
        </div>
      )}
    </div>
  );
}

