// Workspace detail page.
//
// Slice 2 surface: header with name / description / last edited,
// plus a list of codocs with create + delete. Each row is a plain
// card — the detail route for a single codoc (slice 3) is wired as
// a placeholder `href` so the card is obviously clickable once the
// editor ships, without introducing dead UI today.
//
// Data flow mirrors the list page: one query per endpoint, and
// every mutation invalidates the query it wrote to. The workspace
// envelope and the codoc list are separate queries so that editing
// one does not force the other to refetch.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  FileText,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listAgents } from "../api/agents";
import {
  createCodoc,
  deleteCodoc,
  listCodocsByWorkspace,
} from "../api/codocs";
import {
  createThread,
  deleteThread,
  listThreadsByWorkspace,
} from "../api/threads";
import {
  getWorkspace,
  getWorkspaceAgents,
  setWorkspaceAgents,
} from "../api/workspaces";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";

const workspaceKey = (id: string) => ["workspace", id] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;
const threadListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "threads"] as const;
const workspaceAgentsKey = (workspaceId: string) =>
  ["workspace", workspaceId, "agents"] as const;

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

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = id ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const workspaceQuery = useQuery({
    queryKey: workspaceKey(workspaceId),
    queryFn: () => getWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const codocsQuery = useQuery({
    queryKey: codocListKey(workspaceId),
    queryFn: () => listCodocsByWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const threadsQuery = useQuery({
    queryKey: threadListKey(workspaceId),
    queryFn: () => listThreadsByWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const agentsQuery = useQuery({
    queryKey: ["agents"] as const,
    queryFn: listAgents,
  });

  const workspaceAgentsQuery = useQuery({
    queryKey: workspaceAgentsKey(workspaceId),
    queryFn: () => getWorkspaceAgents(workspaceId),
    enabled: workspaceId !== "",
  });

  const createMutation = useMutation({
    mutationFn: createCodoc,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: codocListKey(workspaceId),
      });
      // The count on the workspace envelope moved — refresh both.
      void queryClient.invalidateQueries({
        queryKey: workspaceKey(workspaceId),
      });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCodoc,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: codocListKey(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: workspaceKey(workspaceId),
      });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  // Threads. The workspace envelope does NOT carry a threadCount yet
  // (see packages/service/src/usecases/thread/AGENTS.md — deferred),
  // so thread mutations only need to invalidate the thread list. If
  // a future slice adds threadCount we mirror codoc's fanout.
  const createThreadMutation = useMutation({
    mutationFn: createThread,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: threadListKey(workspaceId),
      });
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: deleteThread,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: threadListKey(workspaceId),
      });
    },
  });

  const setAgentsMutation = useMutation({
    mutationFn: setWorkspaceAgents,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workspaceAgentsKey(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: workspaceKey(workspaceId),
      });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  function toggleWorkspaceAgent(agentId: string) {
    const current = new Set(workspaceAgentsQuery.data?.agentIds ?? []);
    if (current.has(agentId)) {
      current.delete(agentId);
    } else {
      current.add(agentId);
    }
    setAgentsMutation.mutate({ workspaceId, agentIds: [...current] });
  }

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");

  function openCreateDialog() {
    setTitle("");
    setPath("");
    createMutation.reset();
    setDialogOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    await createMutation.mutateAsync({
      workspaceId,
      path: trimmedPath,
      title: title.trim() === "" ? null : title.trim(),
    });
    setDialogOpen(false);
  }

  // Thread creation is a single click: title is always null at
  // creation time (see the "Auto-title from first message" deferred
  // item in packages/service/src/usecases/thread/AGENTS.md). We
  // navigate to the new thread on success so the user lands in the
  // chat page and can start typing.
  async function handleNewChat() {
    const result = await createThreadMutation.mutateAsync({
      workspaceId,
      title: null,
    });
    navigate(
      `/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(result.thread.id)}`,
    );
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (workspaceQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All workspaces
        </Link>
        <p className="mt-6 text-sm text-destructive">
          Failed to load workspace: {(workspaceQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const item = workspaceQuery.data;
  if (!item) return null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All workspaces
      </Link>

      <header className="mt-8 mb-12">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {item.workspace.name}
        </h1>
        {item.workspace.description && (
          <p className="mt-2 text-muted-foreground">
            {item.workspace.description}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Last edited {relativeTime(item.updatedAt)}
        </p>
      </header>

      {/* Agents */}
      {(agentsQuery.data ?? []).length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agents
          </h2>
          <div className="flex flex-wrap gap-2">
            {(agentsQuery.data ?? []).map((a) => {
              const enabled = (
                workspaceAgentsQuery.data?.agentIds ?? []
              ).includes(a.listing.id);
              return (
                <button
                  key={a.listing.id}
                  type="button"
                  onClick={() => toggleWorkspaceAgent(a.listing.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                    enabled
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  <Bot className="h-3.5 w-3.5" />
                  {a.listing.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Codocs */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Codocs
          </h2>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>

        {codocsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : codocsQuery.isError ? (
          <p className="text-sm text-destructive">
            Failed to load codocs: {(codocsQuery.error as Error).message}
          </p>
        ) : codocsQuery.data && codocsQuery.data.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {codocsQuery.data.map((codoc) => (
              <div key={codoc.id} className="group relative">
                <Link
                  to={`/workspace/${encodeURIComponent(workspaceId)}/codoc/${encodeURIComponent(codoc.id)}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {codoc.title ?? codoc.path}
                    </p>
                    {codoc.title && (
                      <p className="truncate text-xs text-muted-foreground">
                        {codoc.path}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(codoc.updatedAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                </Link>
                <div className="absolute right-12 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${codoc.title ?? codoc.path}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteMutation.mutate(codoc.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
            <FileText className="h-6 w-6 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-foreground">
                No codocs yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first codoc to start capturing knowledge.
              </p>
            </div>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="h-3.5 w-3.5" />
              New codoc
            </Button>
          </div>
        )}
      </section>

      {/* Chats */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chats
          </h2>
          <Button
            size="sm"
            onClick={handleNewChat}
            disabled={createThreadMutation.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            {createThreadMutation.isPending ? "Creating…" : "New"}
          </Button>
        </div>

        {threadsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : threadsQuery.isError ? (
          <p className="text-sm text-destructive">
            Failed to load chats: {(threadsQuery.error as Error).message}
          </p>
        ) : threadsQuery.data && threadsQuery.data.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {threadsQuery.data.map((item) => (
              <div key={item.thread.id} className="group relative">
                <Link
                  to={`/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(item.thread.id)}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.thread.title ?? "Untitled"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(item.updatedAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                </Link>
                <div className="absolute right-12 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${item.thread.title ?? "Untitled"}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteThreadMutation.mutate(item.thread.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-foreground">
                No chats yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start a new chat to explore this workspace.
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleNewChat}
              disabled={createThreadMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              {createThreadMutation.isPending ? "Creating…" : "New chat"}
            </Button>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New codoc</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="codoc-path"
                className="text-sm font-medium text-foreground"
              >
                Path
              </label>
              <Input
                id="codoc-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="notes/meeting.codoc"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="codoc-title"
                className="text-sm font-medium text-foreground"
              >
                Title
                <span className="ml-1 font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Input
                id="codoc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Meeting notes"
              />
            </div>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {(createMutation.error as Error).message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!path.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
