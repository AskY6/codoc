// Stripped port of legacy/apps/web/src/pages/workspace-list.tsx.
//
// Slice 1 deliberately drops:
//   - presets
//   - codoc / agent counts
//   - SSE preset apply
//   - workspace detail navigation
//
// Slice 1.5 adds: per-card edit (name + description) with optimistic
// concurrency via `rev`. On WorkspaceConflict, the mutation invalidates
// the workspaces query (refetching the fresh rev) and surfaces an
// inline "someone else edited this" message inside the dialog — the
// user has to re-confirm. Silent replay is deliberately avoided.
//
// The empty-state path doubles as the slice's smoke test, so it has
// its own visible CTA.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "../api/workspaces";
import type { WorkspaceListItem } from "../types";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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

const WORKSPACES_KEY = ["workspaces"] as const;

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

export function WorkspaceListPage() {
  const queryClient = useQueryClient();

  const workspacesQuery = useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: listWorkspaces,
  });

  const createMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
    onError: (error) => {
      // On conflict, refetch the list so the next save sees a fresh
      // rev. The inline error message in the dialog tells the user.
      if (error instanceof ApiError && error.kind === "workspace-conflict") {
        void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
      }
    },
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // `editing` is null when the dialog is in "create" mode; otherwise
  // it holds the list item whose rev we're about to echo back.
  const [editing, setEditing] = useState<WorkspaceListItem | null>(null);

  function openCreateDialog() {
    setEditing(null);
    setName("");
    setDescription("");
    createMutation.reset();
    setDialogOpen(true);
  }

  function openEditDialog(item: WorkspaceListItem) {
    setEditing(item);
    setName(item.workspace.name);
    setDescription(item.workspace.description ?? "");
    updateMutation.reset();
    setDialogOpen(true);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await createMutation.mutateAsync({
      name: trimmed,
      description: description.trim() === "" ? null : description.trim(),
    });
    setDialogOpen(false);
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    // Always read the freshest rev from the cache: if a previous
    // conflict triggered an invalidate, the query has refetched and
    // the card we opened against may now be stale.
    const fresh = queryClient
      .getQueryData<readonly WorkspaceListItem[]>(WORKSPACES_KEY)
      ?.find((it) => it.workspace.id === editing.workspace.id);
    const expectedRev = fresh?.rev ?? editing.rev;

    try {
      await updateMutation.mutateAsync({
        id: editing.workspace.id,
        name: trimmed,
        description: description.trim() === "" ? null : description.trim(),
        expectedRev,
      });
      setDialogOpen(false);
    } catch {
      // Error surface is handled by updateMutation.isError below.
    }
  }

  const updateConflict =
    updateMutation.error instanceof ApiError &&
    updateMutation.error.kind === "workspace-conflict";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium text-neutral-900">Workspaces</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          New workspace
        </Button>
      </div>

      {workspacesQuery.isLoading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : workspacesQuery.isError ? (
        <p className="text-sm text-red-600">
          Failed to load workspaces:{" "}
          {(workspacesQuery.error as Error).message}
        </p>
      ) : workspacesQuery.data && workspacesQuery.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {workspacesQuery.data.map((item) => (
            <Card key={item.workspace.id} className="group relative">
              {/*
                The entire card is a link to the detail page. Edit /
                delete buttons sit on top with stopPropagation so
                clicking them doesn't also navigate.
              */}
              <Link
                to={`/workspace/${encodeURIComponent(item.workspace.id)}`}
                className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                aria-label={`Open ${item.workspace.name}`}
              />
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate">
                      {item.workspace.name}
                    </CardTitle>
                    {item.workspace.description && (
                      <CardDescription className="line-clamp-2">
                        {item.workspace.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="relative z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${item.workspace.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openEditDialog(item);
                      }}
                    >
                      <Pencil className="h-4 w-4 text-neutral-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${item.workspace.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteMutation.mutate(item.workspace.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-neutral-500" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {item.codocCount} codoc{item.codocCount === 1 ? "" : "s"}
                  </span>
                  <span>{relativeTime(item.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-300 py-16 text-center">
          <p className="text-base font-medium text-neutral-900">
            No workspaces yet
          </p>
          <p className="max-w-sm text-sm text-neutral-500">
            Create your first workspace to start collecting codocs and chats.
          </p>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            New workspace
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit workspace" : "New workspace"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={editing ? handleEdit : handleCreate}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="workspace-name"
                className="text-sm font-medium text-neutral-700"
              >
                Name
              </label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My workspace"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="workspace-description"
                className="text-sm font-medium text-neutral-700"
              >
                Description
                <span className="ml-1 font-normal text-neutral-400">
                  (optional)
                </span>
              </label>
              <Input
                id="workspace-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this workspace for?"
              />
            </div>
            {!editing && createMutation.isError && (
              <p className="text-sm text-red-600">
                {(createMutation.error as Error).message}
              </p>
            )}
            {editing && updateConflict && (
              <p className="text-sm text-amber-700">
                Someone else just edited this workspace — the list has
                been reloaded. Review your changes and click Save again
                to overwrite.
              </p>
            )}
            {editing && updateMutation.isError && !updateConflict && (
              <p className="text-sm text-red-600">
                {(updateMutation.error as Error).message}
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
              {editing ? (
                <Button
                  type="submit"
                  disabled={!name.trim() || updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Saving…" : "Save"}
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!name.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating…" : "Create"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
