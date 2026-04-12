import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listAgents } from "../api/agents";
import { createCodoc, deleteCodoc, listCodocsByWorkspace } from "../api/codocs";
import { createThread, deleteThread, listThreadsByWorkspace } from "../api/threads";
import {
  getWorkspace,
  getWorkspaceAgents,
  setWorkspaceAgents,
} from "../api/workspaces";
import { relativeTime } from "../lib/format";
import { CodocTree } from "../components/codoc-tree";
import { ChatLinks } from "../components/chat-links";
import { CreateCodocDialog } from "../components/create-codoc-dialog";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const keys = {
  workspace: (id: string) => ["workspace", id] as const,
  codocs: (id: string) => ["workspace", id, "codocs"] as const,
  threads: (id: string) => ["workspace", id, "threads"] as const,
  wsAgents: (id: string) => ["workspace", id, "agents"] as const,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  // --- queries ---

  const wsQuery = useQuery({
    queryKey: keys.workspace(workspaceId),
    queryFn: () => getWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const codocsQuery = useQuery({
    queryKey: keys.codocs(workspaceId),
    queryFn: () => listCodocsByWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const threadsQuery = useQuery({
    queryKey: keys.threads(workspaceId),
    queryFn: () => listThreadsByWorkspace(workspaceId),
    enabled: workspaceId !== "",
  });

  const agentsQuery = useQuery({
    queryKey: ["agents"] as const,
    queryFn: listAgents,
  });

  const wsAgentsQuery = useQuery({
    queryKey: keys.wsAgents(workspaceId),
    queryFn: () => getWorkspaceAgents(workspaceId),
    enabled: workspaceId !== "",
  });

  // --- mutations ---

  function invalidateWorkspace() {
    void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
  }

  const createCodocMut = useMutation({
    mutationFn: createCodoc,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.codocs(workspaceId) });
      invalidateWorkspace();
    },
  });

  const deleteCodocMut = useMutation({
    mutationFn: deleteCodoc,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.codocs(workspaceId) });
      invalidateWorkspace();
    },
  });

  const createThreadMut = useMutation({
    mutationFn: createThread,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: keys.threads(workspaceId) });
      navigate(
        `/workspace/${encodeURIComponent(workspaceId)}/chat/${encodeURIComponent(result.thread.id)}`,
      );
    },
  });

  const deleteThreadMut = useMutation({
    mutationFn: deleteThread,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.threads(workspaceId) });
    },
  });

  const setAgentsMut = useMutation({
    mutationFn: setWorkspaceAgents,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.wsAgents(workspaceId) });
      invalidateWorkspace();
    },
  });

  // --- handlers ---

  function toggleAgent(agentId: string) {
    const current = new Set(wsAgentsQuery.data?.agentIds ?? []);
    if (current.has(agentId)) current.delete(agentId);
    else current.add(agentId);
    setAgentsMut.mutate({ workspaceId, agentIds: [...current] });
  }

  async function handleCreateCodoc(path: string, title: string | null) {
    await createCodocMut.mutateAsync({ workspaceId, path, title });
  }

  function handleNewChat() {
    createThreadMut.mutate({ workspaceId, title: null });
  }

  // --- loading / error ---

  if (wsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (wsQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" />
          All workspaces
        </Link>
        <p className="mt-4 text-sm text-destructive">
          Failed to load workspace: {(wsQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const ws = wsQuery.data;
  if (!ws) return null;

  const agents = agentsQuery.data ?? [];
  const enabledAgentIds = new Set(wsAgentsQuery.data?.agentIds ?? []);

  // --- render ---

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-base font-semibold tracking-tight truncate">
          {ws.workspace.name}
        </h1>
        <span className="text-xs text-muted-foreground shrink-0">
          {relativeTime(ws.updatedAt)}
        </span>
      </div>

      {ws.workspace.description && (
        <p className="mb-3 text-sm text-muted-foreground pl-7">
          {ws.workspace.description}
        </p>
      )}

      {/* Agent chips */}
      {agents.length > 0 && (
        <div className="flex items-center gap-1.5 mb-5 pl-7">
          <span className="text-[11px] text-muted-foreground mr-1">Agents</span>
          {agents.map((a) => (
            <button
              key={a.listing.id}
              type="button"
              onClick={() => toggleAgent(a.listing.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                enabledAgentIds.has(a.listing.id)
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Bot className="h-3 w-3" />
              {a.listing.name}
            </button>
          ))}
        </div>
      )}

      {/* Codocs — primary */}
      {codocsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading codocs…</p>
      ) : codocsQuery.isError ? (
        <p className="text-sm text-destructive">
          Failed to load codocs: {(codocsQuery.error as Error).message}
        </p>
      ) : (
        <CodocTree
          codocs={codocsQuery.data ?? []}
          workspaceId={workspaceId}
          onDelete={(id) => deleteCodocMut.mutate(id)}
          onCreate={() => {
            createCodocMut.reset();
            setDialogOpen(true);
          }}
        />
      )}

      {/* Chats — secondary */}
      {threadsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading chats…</p>
      ) : threadsQuery.isError ? (
        <p className="text-xs text-destructive">
          Failed to load chats: {(threadsQuery.error as Error).message}
        </p>
      ) : (
        <ChatLinks
          threads={threadsQuery.data ?? []}
          workspaceId={workspaceId}
          onNew={handleNewChat}
          onDelete={(id) => deleteThreadMut.mutate(id)}
          creating={createThreadMut.isPending}
        />
      )}

      <CreateCodocDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreateCodoc}
        isPending={createCodocMut.isPending}
        error={createCodocMut.isError ? (createCodocMut.error as Error) : null}
      />
    </div>
  );
}
