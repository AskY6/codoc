import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewRenderer } from "@/components/view-renderer";
import { buildTree, TreeItem } from "@/components/codoc-browser";
import { normalizeResolvedData } from "@/lib/codoc-utils";
import { ChevronDown, FileText, List } from "lucide-react";
import type { CodocDetail, CodocListItem, ViewNode } from "@/types.js";

interface Props {
  codocs: CodocListItem[];
  codocDetail: CodocDetail | null;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  loading?: boolean;
}

export function CanvasPanel({
  codocs,
  codocDetail,
  selectedPath,
  onSelectPath,
  loading,
}: Props) {
  const tree = useMemo(() => buildTree(codocs), [codocs]);

  // -- Empty state: show inline codoc list --
  if (!selectedPath) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <div className="px-4 pt-5 pb-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Codocs
          </h2>
        </div>
        {codocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <div className="rounded-full bg-muted p-4">
              <FileText className="h-8 w-8" />
            </div>
            <p className="text-sm">No codocs in this workspace</p>
          </div>
        ) : (
          <div className="px-2">
            <TreeItem
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelectPath}
            />
          </div>
        )}
      </div>
    );
  }

  // -- Loading state --
  if (loading || !codocDetail) {
    return (
      <div className="h-full bg-background">
        <div className="flex items-center border-b border-border px-4 py-2">
          <span className="text-sm text-muted-foreground truncate">
            {selectedPath}
          </span>
        </div>
        <div className="p-8 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  const normalizedData = normalizeResolvedData(
    codocDetail.resolvedData,
    codocDetail.path,
  );

  // -- Viewing a codoc: top switcher + content --
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Top switcher */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors min-w-0">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{selectedPath}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-64">
            {codocs.map((c) => (
              <DropdownMenuItem
                key={c.path}
                onClick={() => onSelectPath(c.path)}
                className={
                  c.path === selectedPath
                    ? "bg-primary/10 text-primary"
                    : undefined
                }
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {c.path}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => onSelectPath(null)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <List className="h-3.5 w-3.5" />
          All
        </button>
      </div>

      {/* Codoc content */}
      <div className="flex-1 overflow-y-auto">
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
    </div>
  );
}
