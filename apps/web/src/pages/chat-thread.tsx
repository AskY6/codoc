// Chat thread page.
//
// Slice 5a surface: full chat with agent turns. Header shows thread
// title, agent picker, and codoc context picker. Transcript renders
// both user and assistant messages. Send button calls runAgentTurn
// (synchronous in 5a; slice 5b will upgrade to SSE streaming).
//
// Data flow:
//   1. Single `getThread` query hydrates the page (page-bundle DTO).
//   2. `runAgentTurn` mutation invalidates the thread detail query on
//      success; react-query refetches to pick up new messages.
//   3. Agent/codoc pickers call set* endpoints and invalidate.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Send,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { listAgents } from "../api/agents";
import { listCodocsByWorkspace } from "../api/codocs";
import {
  getThread,
  runAgentTurn,
  setThreadAgents,
  setThreadCodocs,
} from "../api/threads";
import { Button } from "../components/ui/button";
import type {
  AgentListItem,
  ChatMessage,
  CodocListItem,
  ThreadMessage,
  ToolCall,
} from "../types";

const threadKey = (id: string) => ["thread", id] as const;
const agentsKey = ["agents"] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ---- Tool call display (collapsed by default) ---------------------------

function ToolCallIndicator({ toolCalls }: { toolCalls: readonly ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
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
              className="rounded bg-neutral-50 px-2 py-1 font-mono text-xs text-neutral-600"
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
}: {
  item: ThreadMessage;
  agentName: string | null;
}) {
  const msg: ChatMessage = item.message;

  if (msg.kind === "user") {
    return (
      <li className="flex flex-col items-end">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">
          <User className="h-3 w-3" />
          You
        </span>
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-4 py-2 text-sm text-neutral-900">
          {msg.content}
        </div>
      </li>
    );
  }

  if (msg.kind === "assistant") {
    return (
      <li className="flex flex-col items-start">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-blue-600">
          <Bot className="h-3 w-3" />
          {agentName ?? msg.agentId}
        </span>
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-blue-50 px-4 py-2 text-sm text-neutral-900">
          {msg.content}
          <ToolCallIndicator toolCalls={msg.metadata.toolCalls} />
        </div>
      </li>
    );
  }

  // system
  return (
    <li className="flex justify-center">
      <div className="rounded bg-neutral-50 px-3 py-1 text-xs text-neutral-500">
        {msg.content}
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

  const mutation = useMutation({
    mutationFn: setThreadAgents,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
    },
  });

  function toggle(agentId: string) {
    const current = new Set(currentAgentIds);
    if (current.has(agentId)) {
      current.delete(agentId);
    } else {
      current.add(agentId);
    }
    mutation.mutate({ threadId, agentIds: [...current] });
  }

  if (allAgents.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        <Bot className="h-3 w-3" />
        Agents ({currentAgentIds.length})
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          {allAgents.map((a) => {
            const checked = currentAgentIds.includes(a.listing.id);
            return (
              <label
                key={a.listing.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(a.listing.id)}
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                <span className="flex-1 truncate">{a.listing.name}</span>
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

  const mutation = useMutation({
    mutationFn: setThreadCodocs,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
    },
  });

  function toggle(codocId: string) {
    const current = new Set(currentCodocIds);
    if (current.has(codocId)) {
      current.delete(codocId);
    } else {
      current.add(codocId);
    }
    mutation.mutate({ threadId, codocIds: [...current] });
  }

  if (allCodocs.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        <FileText className="h-3 w-3" />
        Codocs ({currentCodocIds.length})
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          {allCodocs.map((c) => {
            const checked = currentCodocIds.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                <span className="flex-1 truncate">
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

  const sendMutation = useMutation({
    mutationFn: runAgentTurn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      setDraft("");
    },
  });

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    await sendMutation.mutateAsync({ threadId, content: trimmed });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as FormEvent);
    }
  }

  // Build agent id → name map for display.
  const agentNameMap = new Map<string, string>();
  for (const a of agentsQuery.data ?? []) {
    agentNameMap.set(a.listing.id, a.listing.name);
  }

  if (threadQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-neutral-500">Loading...</p>
      </div>
    );
  }

  if (threadQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to={`/workspace/${encodeURIComponent(workspaceId)}`}
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to workspace
        </Link>
        <p className="mt-6 text-sm text-red-600">
          Failed to load chat: {(threadQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const detail = threadQuery.data;
  if (!detail) return null;

  return (
    <div className="mx-auto flex h-screen max-w-4xl flex-col px-6 py-10">
      <Link
        to={`/workspace/${encodeURIComponent(workspaceId)}`}
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to workspace
      </Link>

      <header className="mt-6 mb-4">
        <h1 className="text-2xl font-medium text-neutral-900">
          {detail.thread.thread.title ?? "Untitled"}
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
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

      <div className="mb-4 flex-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {detail.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            No messages yet. Say something to start the conversation.
          </p>
        ) : (
          <ul className="space-y-4">
            {detail.messages.map((item) => (
              <MessageBubble
                key={item.message.id}
                item={item}
                agentName={
                  item.message.kind === "assistant"
                    ? agentNameMap.get(item.message.agentId) ?? null
                    : null
                }
              />
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={3}
          className="flex-1 resize-none rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none"
        />
        <Button
          type="submit"
          disabled={draft.trim() === "" || sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sendMutation.isPending ? "Thinking..." : "Send"}
        </Button>
      </form>
      {sendMutation.isError && (
        <p className="mt-2 text-sm text-red-600">
          {(sendMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
