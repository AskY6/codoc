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
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { relativeTime } from "../lib/format";

const WORKSPACES_KEY = ["workspaces"] as const;

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

  // --- search + sort (client-side) ---
  type SortKey = "activity" | "name";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("activity");

  const filtered = useMemo(() => {
    const items = workspacesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    const matched = q
      ? items.filter(
          (it) =>
            it.workspace.name.toLowerCase().includes(q) ||
            (it.workspace.description?.toLowerCase().includes(q) ?? false),
        )
      : items;
    return [...matched].sort((a, b) =>
      sort === "activity"
        ? b.updatedAt - a.updatedAt
        : a.workspace.name.localeCompare(b.workspace.name),
    );
  }, [workspacesQuery.data, search, sort]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Projects
        </h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="pl-9"
        />
      </div>

      {/* Sort */}
      <div className="mb-6 flex justify-end">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="activity">Activity</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {/* Content */}
      {workspacesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workspacesQuery.isError ? (
        <p className="text-sm text-destructive">
          Failed to load workspaces:{" "}
          {(workspacesQuery.error as Error).message}
        </p>
      ) : workspacesQuery.data && workspacesQuery.data.length > 0 ? (
        filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filtered.map((item) => (
              <Link
                key={item.workspace.id}
                to={`/workspace/${encodeURIComponent(item.workspace.id)}`}
                className="group relative flex min-h-[140px] flex-col rounded-lg border border-border bg-background p-5 transition-colors hover:bg-muted/40"
              >
                <p className="text-sm font-semibold text-foreground">
                  {item.workspace.name}
                </p>
                {item.workspace.description && (
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                    {item.workspace.description}
                  </p>
                )}
                <p className="mt-auto pt-4 text-xs text-muted-foreground">
                  Updated {relativeTime(item.updatedAt)}
                </p>

                {/* Hover actions */}
                <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
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
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No projects matching &ldquo;{search}&rdquo;
          </p>
        )
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            No projects yet
          </p>
          <p className="text-sm text-muted-foreground">
            Create your first project to start collecting codocs and chats.
          </p>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit project" : "New project"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={editing ? handleEdit : handleCreate}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="workspace-name"
                className="text-sm font-medium text-foreground"
              >
                Name
              </label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My project"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="workspace-description"
                className="text-sm font-medium text-foreground"
              >
                Description
                <span className="ml-1 font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Input
                id="workspace-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this project for?"
              />
            </div>
            {!editing && createMutation.isError && (
              <p className="text-sm text-destructive">
                {(createMutation.error as Error).message}
              </p>
            )}
            {editing && updateConflict && (
              <p className="text-sm text-warning-foreground">
                Someone else just edited this project — the list has
                been reloaded. Review your changes and click Save again
                to overwrite.
              </p>
            )}
            {editing && updateMutation.isError && !updateConflict && (
              <p className="text-sm text-destructive">
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
