// Chat thread page.
//
// Slice 4 surface: a minimal chat view. Header shows the thread
// title (or "Untitled"), a scrollable transcript renders the user
// messages currently in the thread, and a textarea + Send button
// appends a new user message. No agent runtime yet — slice 5 will
// add assistant replies via a sibling run-agent-turn use case.
//
// Data flow:
//   1. Single `getThread` query hydrates the entire page (the
//      page-bundle DTO pattern — see backend
//      packages/service/src/usecases/thread/AGENTS.md).
//   2. `appendUserMessage` mutation invalidates the thread detail
//      query on success; react-query refetches, which picks up the
//      newly assigned `seq` and keeps the transcript ordered.
//   3. Thread envelope `updatedAt` does NOT bump on append (see
//      ThreadStore.appendMessage contract), so the workspace list's
//      "last edited" timestamp is intentionally stable across chat
//      activity.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { appendUserMessage, getThread } from "../api/threads";
import { Button } from "../components/ui/button";

const threadKey = (id: string) => ["thread", id] as const;

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

  const [draft, setDraft] = useState("");

  const sendMutation = useMutation({
    mutationFn: appendUserMessage,
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

  // Enter submits, shift+enter inserts a newline. Mirrors the
  // familiar chat-input convention.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as FormEvent);
    }
  }

  if (threadQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-neutral-500">Loading…</p>
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

      <header className="mt-6 mb-6">
        <h1 className="text-2xl font-medium text-neutral-900">
          {detail.thread.thread.title ?? "Untitled"}
        </h1>
        <p className="mt-2 text-xs text-neutral-500">
          Last edited {relativeTime(detail.thread.updatedAt)}
        </p>
      </header>

      <div className="mb-4 flex-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {detail.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            No messages yet. Say something to start the conversation.
          </p>
        ) : (
          <ul className="space-y-4">
            {detail.messages.map((item) => (
              <li key={item.message.id} className="flex flex-col">
                <span className="mb-1 text-xs font-medium text-neutral-500">
                  You
                </span>
                <div className="whitespace-pre-wrap rounded-lg bg-neutral-100 px-4 py-2 text-sm text-neutral-900">
                  {item.message.content}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={3}
          className="flex-1 resize-none rounded-lg border border-neutral-300 bg-white p-3 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none"
        />
        <Button
          type="submit"
          disabled={draft.trim() === "" || sendMutation.isPending}
        >
          <Send className="h-4 w-4" />
          {sendMutation.isPending ? "Sending…" : "Send"}
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
