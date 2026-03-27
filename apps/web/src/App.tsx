import { type ComponentType } from "react";
import type { MultiDocRuntime, CodocRuntime } from "./runtime/runtime.js";
import { DocPanel } from "./components/DocPanel.js";
import { UnifiedDAG } from "./components/UnifiedDAG.js";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface DocOp {
  label: string;
  action: () => void;
}

export interface DocEntry {
  docId: string;
  runtime: CodocRuntime;
  rawSource: string;
  role: "provider" | "consumer";
  ops: DocOp[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MDXContent: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents: Record<string, ComponentType<any>>;
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
    <div className="space-y-3 p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">CoDoc Inspector</h1>
          <p className="text-xs text-muted-foreground">
            Three <code className="rounded bg-muted px-1 font-mono text-[10px]">.codoc</code> documents
            with cross-document <code className="rounded bg-muted px-1 font-mono text-[10px]">$ref</code>,
            async <code className="rounded bg-muted px-1 font-mono text-[10px]">$source</code> /
            <code className="rounded bg-muted px-1 font-mono text-[10px]">$prompt</code> loaders,
            and custom JSX components.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => multi.forceAll()}>
          <code className="text-xs">forceAll()</code>
        </Button>
      </div>

      {/* Four-column layout: DAG | doc1 | doc2 | doc3 */}
      <div className="grid grid-cols-4 items-start gap-3">
        {/* DAG panel */}
        <Card>
          <CardHeader className="px-3 py-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Dependency Graph
              </span>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm border border-[#82c091] bg-[#d4edda]" />
                  resolved
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm border border-[#e0a800] bg-[#fff3cd]" />
                  dirty
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm border border-[#adb5bd] bg-[#e2e3e5]" />
                  pending
                </span>
                <span className="flex items-center gap-1">
                  <svg width={14} height={6}><line x1={0} y1={3} x2={14} y2={3} stroke="#3b82f6" strokeWidth={1.5} /></svg>
                  cross-doc
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0 overflow-x-auto">
            <UnifiedDAG runtimes={runtimes} />
          </CardContent>
        </Card>

        {/* Doc panels */}
        {docs.map((doc) => (
          <DocPanel
            key={doc.docId}
            docId={doc.docId}
            runtime={doc.runtime}
            rawSource={doc.rawSource}
            MDXContent={doc.MDXContent}
            mdxComponents={doc.mdxComponents}
            role={doc.role}
            ops={doc.ops}
          />
        ))}
      </div>
    </div>
  );
}
