// Right-column codoc viewer panel for the chat two-column layout.
//
// Fetches a single codoc by ID and renders it via MdxRenderer,
// reusing the same MDX infrastructure as the codoc detail page.

import { useQuery } from "@tanstack/react-query";
import { Check, Code2, Copy, Eye, Loader2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { getCodoc } from "../api/codocs";
import type { ResolveResult } from "../types";
import { MdxRenderer } from "./mdx/renderer";
import { codocComponents } from "./mdx/component-map";
import { parseCodocContent } from "./mdx/parse-frontmatter";

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

export interface CodocPanelProps {
  readonly codocId: string;
  readonly onClose: () => void;
}

const codocKey = (id: string) => ["codoc", id] as const;

export function CodocPanel({ codocId, onClose }: CodocPanelProps) {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);

  const codocQuery = useQuery({
    queryKey: codocKey(codocId),
    queryFn: () => getCodoc(codocId),
  });

  const handleCopy = useCallback(() => {
    const content = codocQuery.data?.content;
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codocQuery.data?.content]);

  const parsed = useMemo(
    () =>
      codocQuery.data?.content
        ? parseCodocContent(codocQuery.data.content)
        : null,
    [codocQuery.data?.content],
  );

  const hasMdx = parsed !== null && parsed.body.length > 0;

  return (
    <div className="flex h-full flex-col border-l border-border bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        {/* View mode toggle */}
        <div className="flex items-center rounded-md border border-border">
          <button
            type="button"
            onClick={() => setViewMode("preview")}
            className={`rounded-l-md p-1.5 transition-colors ${viewMode === "preview" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Preview"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("source")}
            className={`rounded-r-md border-l border-border p-1.5 transition-colors ${viewMode === "source" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Source"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Title */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {codocQuery.data?.title ?? codocQuery.data?.path ?? "Loading…"}
            {codocQuery.data?.path && codocQuery.data.title && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {codocQuery.data.path.split("/").pop()}
              </span>
            )}
          </p>
        </div>

        {/* Actions */}
        <button
          type="button"
          onClick={handleCopy}
          disabled={!codocQuery.data?.content}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {codocQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {codocQuery.isError && (
          <p className="text-sm text-destructive">
            Failed to load codoc: {(codocQuery.error as Error).message}
          </p>
        )}

        {codocQuery.data && (
          <>
            {viewMode === "source" ? (
              <pre className="whitespace-pre-wrap font-mono text-sm text-muted-foreground">
                {codocQuery.data.content || "Empty"}
              </pre>
            ) : hasMdx ? (
              <MdxRenderer
                source={parsed.body}
                data={readyValues(codocQuery.data.resolvedData) ?? parsed.data}
                components={codocComponents}
              />
            ) : codocQuery.data.content.trim() ? (
              <pre className="whitespace-pre-wrap font-mono text-sm text-muted-foreground">
                {codocQuery.data.content}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                This codoc has no content.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
