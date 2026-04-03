import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
} from "@/api/workspace.js";
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, Plus, MoreVertical, Trash2 } from "lucide-react";
import type { Workspace } from "@/types.js";

export function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const ws = await createWorkspace(addName.trim());
      setWorkspaces((prev) => [...prev, ws]);
      setAddName("");
      setDialogOpen(false);
    } catch (err) {
      alert(String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWorkspace(id);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== id));
    } catch (err) {
      alert(String(err));
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-medium">Workspaces</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Add workspace
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 mt-2">
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Workspace name..."
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={adding || !addName.trim()}>
                  {adding ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="rounded-full bg-muted p-6">
            <FolderOpen className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">No workspaces yet</p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create your first workspace
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((ws) => (
            <Card key={ws.id} className="group relative hover:shadow-md transition-shadow">
              <Link to={`/workspace/${ws.id}`} className="absolute inset-0 z-0" />
              <CardHeader className="relative z-10 pointer-events-none">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg">{ws.name}</CardTitle>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="pointer-events-auto h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.preventDefault()}
                        />
                      }
                    >
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="pointer-events-auto">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.preventDefault();
                          handleDelete(ws.id);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
