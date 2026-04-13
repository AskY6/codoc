// Codoc detail + edit page.
//
// Two modes: View (rendered MDX) and Edit (raw textarea).
// View mode parses frontmatter client-side to extract the MDX body
// and data fields, then renders via the MdxRenderer component.
// Edit mode is the original textarea with Save and conflict recovery.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { getCodoc, updateCodocContent } from "../api/codocs";
import type { CodocDetail, ResolveResult } from "../types";
import { Button } from "../components/ui/button";
import { MdxRenderer } from "../components/mdx/renderer";
import { codocComponents } from "../components/mdx/component-map";
import { parseCodocContent } from "../components/mdx/parse-frontmatter";
import { relativeTime } from "../lib/format";

/** Extract ready values from resolved data for the MDX renderer. */
function readyValues(
  resolved: Record<string, ResolveResult> | null,
): Record<string, unknown> | null {
  if (!resolved) return null;
  const out: Record<string, unknown> = {};
  let has = false;
  for (const [k, v] of Object.entries(resolved)) {
    if (v.kind === "ready") {
      out[k] = v.value;
      has = true;
    }
  }
  return has ? out : null;
}

const codocKey = (id: string) => ["codoc", id] as const;
const codocListKey = (workspaceId: string) =>
  ["workspace", workspaceId, "codocs"] as const;
const workspaceKey = (id: string) => ["workspace", id] as const;

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

  const [editorContent, setEditorContent] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    if (editorContent === null && codocQuery.data) {
      setEditorContent(codocQuery.data.content);
    }
  }, [editorContent, codocQuery.data]);

  const updateMutation = useMutation({
    mutationFn: updateCodocContent,
    onSuccess: (next) => {
      queryClient.setQueryData<CodocDetail>(codocKey(codocId), next);
      void queryClient.invalidateQueries({
        queryKey: codocListKey(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: workspaceKey(workspaceId),
      });
      setEditorContent(next.content);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.kind === "codoc-conflict") {
        void queryClient.invalidateQueries({ queryKey: codocKey(codocId) });
      }
    },
  });

  async function handleSave() {
    if (editorContent === null) return;
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
      // Error surface handled below.
    }
  }

  function handleReloadFromServer() {
    const fresh = queryClient.getQueryData<CodocDetail>(codocKey(codocId));
    if (fresh) {
      setEditorContent(fresh.content);
      updateMutation.reset();
    }
  }

  // Parse content for the view mode.
  const parsed = useMemo(
    () => (editorContent ? parseCodocContent(editorContent) : null),
    [editorContent],
  );

  const hasMdxContent = parsed !== null && parsed.body.length > 0;

  const conflict =
    updateMutation.error instanceof ApiError &&
    updateMutation.error.kind === "codoc-conflict";

  if (codocQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (codocQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
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
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Compact top bar: back + title + meta + mode toggle */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          to={`/workspace/${encodeURIComponent(workspaceId)}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-foreground truncate">
            {codoc.title ?? codoc.path}
          </h1>
          <span className="text-xs text-muted-foreground shrink-0">{codoc.path}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {relativeTime(codoc.updatedAt)}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setMode("view")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "view"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-3 w-3" />
              View
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === "edit"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
          {dirty && (
            <span className="text-xs text-muted-foreground">Unsaved</span>
          )}
          {mode === "edit" && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {/* View mode */}
      {mode === "view" && (
        <div className="rounded-lg border border-border p-5">
          {hasMdxContent ? (
            <MdxRenderer
              source={parsed.body}
              data={readyValues(codoc.resolvedData) ?? parsed.data}
              components={codocComponents}
            />
          ) : editorContent.trim() ? (
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-mono">
              {editorContent}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No content yet. Switch to Edit mode to start writing.
            </p>
          )}
        </div>
      )}

      {/* Edit mode */}
      {mode === "edit" && (
        <>
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
        </>
      )}
    </div>
  );
}
