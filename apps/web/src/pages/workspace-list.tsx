// Stripped port of legacy/apps/web/src/pages/workspace-list.tsx.
//
// Slice 1 deliberately drops:
//   - presets
//   - codoc / agent counts
//   - SSE preset apply
//   - workspace edit / detail navigation
//
// What stays: a card grid of workspaces with name, description and a
// relative timestamp; a "create workspace" dialog (name + description);
// per-card delete. The empty-state path doubles as the slice's smoke
// test, so it has its own visible CTA.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "../api/workspaces";
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function openDialog() {
    setName("");
    setDescription("");
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium text-neutral-900">Workspaces</h1>
        <Button onClick={openDialog}>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${item.workspace.name}`}
                    onClick={() =>
                      deleteMutation.mutate(item.workspace.id)
                    }
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4 text-neutral-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-neutral-500">
                  {relativeTime(item.updatedAt)}
                </p>
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
          <Button onClick={openDialog}>
            <Plus className="h-4 w-4" />
            New workspace
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
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
                disabled={!name.trim() || createMutation.isPending}
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
