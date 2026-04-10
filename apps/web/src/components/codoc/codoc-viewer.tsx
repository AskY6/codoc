import { MdxRenderer } from "@/components/codoc/MdxRenderer";
import { getComponentsForTags } from "@/components/codoc/index";
import { normalizeResolvedData } from "@/lib/codoc-utils";
import {
  isClientSourceName,
  resolveClientSource,
} from "@/lib/source-registry";
import { Code, Eye, FileText, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import type { CodocDetail, DataField, ViewAction } from "@/types.js";
import type { MdxView } from "@cobook/core";

interface Props {
  codoc: CodocDetail;
  onAction?: ((action: ViewAction) => void) | undefined;
}

function isMdxView(view: unknown): view is MdxView {
  return (
    view != null &&
    typeof view === "object" &&
    "type" in view &&
    (view as Record<string, unknown>)["type"] === "mdx"
  );
}

export function CodocViewer({ codoc, onAction }: Props) {
  const [clientData, setClientData] = useState<Record<string, unknown>>({});
  const [clientError, setClientError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  // Resolve client-side sources that the server skipped (value = null)
  useEffect(() => {
    const dataFields = codoc.ast?.data;
    if (!dataFields) return;

    const sourceFields = Object.entries(dataFields).filter(
      ([, f]: [string, DataField]) =>
        f.kind === "source" && isClientSourceName(f.source),
    );

    if (sourceFields.length === 0) return;

    let cancelled = false;
    setClientError(null);

    Promise.all(
      sourceFields.map(async ([key, field]) => {
        if (field.kind !== "source") return [key, null] as const;
        const result = await resolveClientSource(field.source, field.params);
        return [key, result.data] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const resolved: Record<string, unknown> = {};
      for (const [key, data] of entries) {
        resolved[`${codoc.path}#data.${key}`] = data;
      }
      setClientData(resolved);
    }).catch((err) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      setClientError(msg);
    });

    return () => {
      cancelled = true;
    };
  }, [codoc]);

  const mergedResolved = { ...codoc.resolvedData, ...clientData };
  const normalizedData = normalizeResolvedData(mergedResolved, codoc.path);

  const view = codoc.ast?.view;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {codoc.ast?.meta?.title && (
            <h1 className="text-xl font-medium text-foreground mb-1">
              {codoc.ast.meta.title}
            </h1>
          )}
          {codoc.ast?.meta?.description && (
            <p className="text-sm text-muted-foreground">
              {codoc.ast.meta.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={showSource ? "Show rendered view" : "Show source"}
        >
          {showSource ? (
            <>
              <Eye className="h-3.5 w-3.5" />
              Rendered
            </>
          ) : (
            <>
              <Code className="h-3.5 w-3.5" />
              Source
            </>
          )}
        </button>
      </div>

      {/* Client source error */}
      {clientError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-destructive">
                Failed to load local data
              </h4>
              <p className="text-xs text-destructive/80 mt-1">
                {clientError}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Make sure the local-connector daemon is running.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {showSource ? (
        <pre className="overflow-auto rounded-md border border-border bg-muted/50 p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
          <code>{codoc.content}</code>
        </pre>
      ) : isMdxView(view) ? (
        <MdxRenderer
          source={view.source}
          data={normalizedData ?? {}}
          components={getComponentsForTags(codoc.ast?.meta?.tags ?? [])}
          onAction={onAction}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <FileText className="h-6 w-6" />
          <p className="text-sm">
            {view
              ? "Unsupported view format — only MDX views are supported"
              : "No view defined for this codoc"}
          </p>
        </div>
      )}
    </div>
  );
}
