import { ViewRenderer } from "@/components/view-renderer";
import { normalizeResolvedData } from "@/lib/codoc-utils";
import { FileText } from "lucide-react";
import type { CodocDetail, ViewAction, ViewNode } from "@/types.js";

interface Props {
  codoc: CodocDetail;
  onAction?: ((action: ViewAction) => void) | undefined;
}

export function CodocViewer({ codoc, onAction }: Props) {
  const normalizedData = normalizeResolvedData(codoc.resolvedData, codoc.path);

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

      {/* View content */}
      {codoc.ast?.view ? (
        <ViewRenderer
          node={codoc.ast.view as ViewNode}
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
