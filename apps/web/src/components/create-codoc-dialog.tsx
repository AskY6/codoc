import type { FormEvent } from "react";
import { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function CreateCodocDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string, title: string | null) => Promise<void>;
  isPending: boolean;
  error: Error | null;
}) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle("");
      setPath("");
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    await onCreate(trimmedPath, title.trim() || null);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New codoc</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
          {error && (
            <p className="text-sm text-destructive">{error.message}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!path.trim() || isPending}
            >
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
