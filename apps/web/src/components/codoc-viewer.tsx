import { ViewRenderer } from "@/components/view-renderer";
import { MdxRenderer } from "@/components/codoc/MdxRenderer";
import { normalizeResolvedData } from "@/lib/codoc-utils";
import {
  isClientSourceName,
  resolveClientSource,
} from "@/lib/source-registry";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { CodocDetail, DataField, ViewAction, ViewNode } from "@/types.js";
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
        resolved[`${codoc.path}#${key}`] = data;
      }
      setClientData(resolved);
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
      <div className="mb-6">
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

      {/* View content — MDX or legacy YAML view tree */}
      {isMdxView(view) ? (
        <MdxRenderer
          source={view.source}
          data={normalizedData ?? {}}
          onAction={onAction}
        />
      ) : view ? (
        <ViewRenderer
          node={view as ViewNode}
          data={normalizedData}
          onAction={onAction}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <FileText className="h-6 w-6" />
          <p className="text-sm">No view defined for this codoc</p>
        </div>
      )}
    </div>
  );
}
