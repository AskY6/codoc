// Right-column codoc viewer panel for the chat two-column layout.
//
// Fetches a single codoc by ID and renders it via MdxRenderer,
// reusing the same MDX infrastructure as the codoc detail page.

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useMemo } from "react";
import { getCodoc } from "../api/codocs";
import { MdxRenderer } from "./mdx/renderer";
import { codocComponents } from "./mdx/component-map";
import { parseCodocContent } from "./mdx/parse-frontmatter";

export interface CodocPanelProps {
  readonly codocId: string;
  readonly onClose: () => void;
}

const codocKey = (id: string) => ["codoc", id] as const;

export function CodocPanel({ codocId, onClose }: CodocPanelProps) {
  const codocQuery = useQuery({
    queryKey: codocKey(codocId),
    queryFn: () => getCodoc(codocId),
  });

  const parsed = useMemo(
    () =>
      codocQuery.data?.content
        ? parseCodocContent(codocQuery.data.content)
        : null,
    [codocQuery.data?.content],
  );

  const hasMdx = parsed !== null && parsed.body.length > 0;

  return (
    <div className="flex h-full flex-col border-l border-border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {codocQuery.data?.title ?? codocQuery.data?.path ?? "Loading…"}
          </h2>
          {codocQuery.data?.path && codocQuery.data.title && (
            <p className="truncate text-xs text-muted-foreground">
              {codocQuery.data.path}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
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
            {hasMdx ? (
              <MdxRenderer
                source={parsed.body}
                data={parsed.data}
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
