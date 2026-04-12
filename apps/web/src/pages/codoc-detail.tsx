// Codoc detail + edit page.
//
// Slice 3 surface: header with path / title / last edited, a textarea
// bound to the raw `content`, and Save with optimistic concurrency.
// The ast is not on the wire — the editor only touches `content`, and
// the service preserves `ast.meta` / `ast.data` / `ast.view`
// unchanged until the slice that ships the parser lands.
//
// Conflict recovery differs from slice 1.5: the workspace list dialog
// throws away the user's (short) buffer on 409 and forces a refetch.
// For long-form content that's unacceptable. We instead:
//
//   1. Keep `editorContent` in component state, seeded from the server
//      copy on mount and on explicit reload only.
//   2. On 409 invalidate + refetch the detail query so the cache
//      holds the latest rev — but DO NOT clobber the editor buffer.
//   3. Show an inline amber warning telling the user the server moved
//      on and that saving again will overwrite. The user's next save
//      reads the fresh rev from the query cache (mirrors
//      workspace-list handleEdit).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { getCodoc, updateCodocContent } from "../api/codocs";
import type { CodocDetail } from "../types";
import { Button } from "../components/ui/button";

const codocKey = (id: string) => ["codoc", id] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;
const workspaceKey = (id: string) => ["workspace", id] as const;

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

export function CodocDetailPage() {
  const { workspaceId: wsParam, codocId: codocParam } = useParams<{
    workspaceId: string;
    codocId: string;
  }>();
  const workspaceId = wsParam ?? "";
  const codocId = codocParam ?? "";
  const queryClient = useQueryClient();

  const codocQuery = useQuery({
    queryKey: codocKey(codocId),
    queryFn: () => getCodoc(codocId),
    enabled: codocId !== "",
  });

  // Editor buffer lives in component state so conflict-recovery can
  // keep the user's in-progress text. Seeded from the server copy on
  // first successful load; subsequent refetches (triggered by a
  // conflict) deliberately do NOT overwrite it.
  const [editorContent, setEditorContent] = useState<string | null>(null);
  useEffect(() => {
    if (editorContent === null && codocQuery.data) {
      setEditorContent(codocQuery.data.content);
    }
  }, [editorContent, codocQuery.data]);

  const updateMutation = useMutation({
    mutationFn: updateCodocContent,
    onSuccess: (next) => {
      // The detail query holds the fresh rev.
      queryClient.setQueryData<CodocDetail>(codocKey(codocId), next);
      // The workspace codoc list shows this codoc's updatedAt.
      void queryClient.invalidateQueries({
        queryKey: codocListKey(workspaceId),
      });
      // The workspace envelope's updatedAt does NOT change on codoc
      // edit, but its displayed codoc list does — invalidate both so
      // navigation back picks up the fresh rev.
      void queryClient.invalidateQueries({
        queryKey: workspaceKey(workspaceId),
      });
      // Align the editor buffer with what the server now has.
      setEditorContent(next.content);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.kind === "codoc-conflict") {
        // Refetch so the cache has the latest rev. Keep the editor
        // buffer untouched — the user decides whether to re-save
        // (overwrite) or manually reset.
        void queryClient.invalidateQueries({ queryKey: codocKey(codocId) });
      }
    },
  });

  async function handleSave() {
    if (editorContent === null) return;
    // Read the freshest rev from the cache: a previous conflict may
    // have triggered an invalidate + refetch, moving the server copy
    // past the rev the page mounted with.
    const fresh = queryClient.getQueryData<CodocDetail>(codocKey(codocId));
    const expectedRev = fresh?.rev ?? codocQuery.data?.rev;
    if (!expectedRev) return;

    try {
      await updateMutation.mutateAsync({
        id: codocId,
        content: editorContent,
        expectedRev,
      });
    } catch {
      // Error surface handled below via updateMutation.isError.
    }
  }

  function handleReloadFromServer() {
    const fresh = queryClient.getQueryData<CodocDetail>(codocKey(codocId));
    if (fresh) {
      setEditorContent(fresh.content);
      updateMutation.reset();
    }
  }

  const conflict =
    updateMutation.error instanceof ApiError &&
    updateMutation.error.kind === "codoc-conflict";

  if (codocQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (codocQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          to={`/workspace/${encodeURIComponent(workspaceId)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to workspace
        </Link>
        <p className="mt-6 text-sm text-destructive">
          Failed to load codoc: {(codocQuery.error as Error).message}
        </p>
      </div>
    );
  }

  const codoc = codocQuery.data;
  if (!codoc || editorContent === null) return null;

  const dirty = editorContent !== codoc.content;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        to={`/workspace/${encodeURIComponent(workspaceId)}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to workspace
      </Link>

      <header className="mt-8 mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {codoc.title ?? codoc.path}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{codoc.path}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Last edited {relativeTime(codoc.updatedAt)}
        </p>
      </header>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Content
        </h2>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <textarea
        value={editorContent}
        onChange={(e) => setEditorContent(e.target.value)}
        className="min-h-[24rem] w-full rounded-lg border border-border bg-background p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        placeholder="Start typing…"
        spellCheck={false}
      />

      {conflict && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
          <p className="font-medium">This codoc has moved on.</p>
          <p className="mt-1">
            Someone else saved changes while you were editing. Your draft
            above is preserved. Click <strong>Save</strong> again to
            overwrite their changes with yours, or use{" "}
            <button
              type="button"
              onClick={handleReloadFromServer}
              className="underline hover:opacity-80"
            >
              reload from server
            </button>{" "}
            to discard your draft.
          </p>
        </div>
      )}
      {updateMutation.isError && !conflict && (
        <p className="mt-4 text-sm text-destructive">
          {(updateMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
