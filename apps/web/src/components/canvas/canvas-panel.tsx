import { Skeleton } from "@/components/ui/skeleton";
import { ViewRenderer } from "@/components/view-renderer";
import { normalizeResolvedData } from "@/lib/codoc-utils";
import { FileText } from "lucide-react";
import type { CodocDetail, ViewNode } from "@/types.js";

interface Props {
  codocDetail: CodocDetail | null;
  selectedPath: string | null;
  loading?: boolean;
}

export function CanvasPanel({ codocDetail, selectedPath, loading }: Props) {
  if (!selectedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <div className="rounded-full bg-muted p-4">
          <FileText className="h-8 w-8" />
        </div>
        <p className="text-sm">Select a codoc to view its content</p>
        <p className="text-xs">
          Open the codoc browser with the folder icon above
        </p>
      </div>
    );
  }

  if (loading || !codocDetail) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const normalizedData = normalizeResolvedData(
    codocDetail.resolvedData,
    codocDetail.path,
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          {codocDetail.ast?.meta?.title && (
            <h1 className="text-xl font-medium text-foreground mb-1">
              {codocDetail.ast.meta.title}
            </h1>
          )}
          {codocDetail.ast?.meta?.description && (
            <p className="text-sm text-muted-foreground">
              {codocDetail.ast.meta.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {codocDetail.path}
          </p>
        </div>

        {/* View content */}
        {codocDetail.ast?.view ? (
          <ViewRenderer
            node={codocDetail.ast.view as ViewNode}
            data={normalizedData}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <FileText className="h-6 w-6" />
            <p className="text-sm">No view defined for this codoc</p>
          </div>
        )}
      </div>
    </div>
  );
}
