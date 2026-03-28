"use client";

import { useWorkspaceDocs, useWorkspaceGraph } from "@/hooks/use-workspace";

interface GraphViewProps {
  selectedDocId: string | null;
  onSelectDoc: (docId: string) => void;
}

export function GraphView({ selectedDocId, onSelectDoc }: GraphViewProps) {
  const docs = useWorkspaceDocs();
  const graph = useWorkspaceGraph();

  if (docs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No documents found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-2">
        <h2 className="text-sm font-medium">Documents</h2>
        <p className="text-xs text-muted-foreground">
          {docs.length} docs, {graph.nodes.length} fields, {graph.edges.length} edges
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <ul className="divide-y">
          {docs.map((doc) => (
            <li key={doc.docId}>
              <button
                onClick={() => onSelectDoc(doc.docId)}
                className={`w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors ${
                  selectedDocId === doc.docId ? "bg-secondary" : ""
                }`}
              >
                <div className="font-mono text-sm">{doc.docId}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {doc.fields.length} fields
                  {doc.fields.some((f) => f.loaderType === "source") && " · $source"}
                  {doc.fields.some((f) => f.loaderType === "prompt") && " · $prompt"}
                  {doc.fields.some((f) => f.loaderType === "external") && " · external"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
