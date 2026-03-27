import { type ComponentType } from "react";
import type { MultiDocRuntime, CodocRuntime } from "./runtime.js";
import { OpsBar } from "./OpsBar.js";
import { DocPanel } from "./DocPanel.js";
import { UnifiedDAG } from "./UnifiedDAG.js";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface DocEntry {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  role: "provider" | "consumer";
  MDXContent: ComponentType<{ components: Record<string, ComponentType<{ path: string }>> }>;
}

export function App({
  multi,
  docs,
}: {
  multi: MultiDocRuntime;
  docs: DocEntry[];
}) {
  const runtimes = new Map<string, CodocRuntime>();
  for (const doc of docs) {
    runtimes.set(doc.docId, doc.runtime);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">CoDoc Inspector</h1>
        <p className="text-sm text-muted-foreground">
          Two <code className="rounded bg-muted px-1 font-mono text-xs">.codoc</code> documents
          are linked via cross-document <code className="rounded bg-muted px-1 font-mono text-xs">$ref</code>.
          Click an operation below to update B's fields, then watch the changes propagate through the dependency graph to A.
        </p>
      </div>

      {/* Operations */}
      <OpsBar multi={multi} />

      {/* Unified DAG */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Dependency Graph
            </span>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#82c091] bg-[#d4edda]" />
                resolved
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#e0a800] bg-[#fff3cd]" />
                dirty
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#adb5bd] bg-[#e2e3e5]" />
                pending
              </span>
              <span className="flex items-center gap-1">
                <svg width={20} height={8}><line x1={0} y1={4} x2={20} y2={4} stroke="#3b82f6" strokeWidth={1.5} /></svg>
                cross-doc ref
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex justify-center overflow-x-auto">
          <UnifiedDAG runtimes={runtimes} />
        </CardContent>
      </Card>

      {/* Document panels side by side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {docs.map((doc) => (
          <DocPanel
            key={doc.docId}
            docId={doc.docId}
            runtime={doc.runtime}
            rawSource={doc.rawSource}
            MDXContent={doc.MDXContent}
            role={doc.role}
          />
        ))}
      </div>
    </div>
  );
}
