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
import { ArrowLeft, FileText, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createCodoc,
  deleteCodoc,
  listCodocsByWorkspace,
} from "../api/codocs";
import { getWorkspace } from "../api/workspaces";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
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

  if (workspaceQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    );
  }

  if (workspaceQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" />
          All workspaces
        </Link>
        <p className="mt-6 text-sm text-red-600">
          Failed to load workspace: {(workspaceQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const item = workspaceQuery.data;
  if (!item) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
      >
        <ArrowLeft className="h-4 w-4" />
        All workspaces
      </Link>

      <header className="mt-6 mb-8">
        <h1 className="text-2xl font-medium text-neutral-900">
          {item.workspace.name}
        </h1>
        {item.workspace.description && (
          <p className="mt-2 text-sm text-neutral-600">
            {item.workspace.description}
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Last edited {relativeTime(item.updatedAt)}
        </p>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-neutral-900">Codocs</h2>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          New codoc
        </Button>
      </div>

      {codocsQuery.isLoading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : codocsQuery.isError ? (
        <p className="text-sm text-red-600">
          Failed to load codocs: {(codocsQuery.error as Error).message}
        </p>
      ) : codocsQuery.data && codocsQuery.data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {codocsQuery.data.map((codoc) => (
            <Card key={codoc.id} className="group relative">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                      <span className="truncate">
                        {codoc.title ?? codoc.path}
                      </span>
                    </CardTitle>
                    <p className="mt-1 truncate text-xs text-neutral-500">
                      {codoc.path}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${codoc.title ?? codoc.path}`}
                      onClick={() => deleteMutation.mutate(codoc.id)}
                    >
                      <Trash2 className="h-4 w-4 text-neutral-500" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-neutral-500">
                  {relativeTime(codoc.updatedAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-300 py-16 text-center">
          <p className="text-base font-medium text-neutral-900">
            No codocs yet
          </p>
          <p className="max-w-sm text-sm text-neutral-500">
            Create your first codoc to start capturing knowledge in this
            workspace.
          </p>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            New codoc
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New codoc</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="codoc-path"
                className="text-sm font-medium text-neutral-700"
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
                className="text-sm font-medium text-neutral-700"
              >
                Title
                <span className="ml-1 font-normal text-neutral-400">
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
              <p className="text-sm text-red-600">
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
