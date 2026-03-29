"use client";

import { useState } from "react";
import {
  useWorkspaceDocs,
  useWorkspaceGraph,
} from "@/workspace/hooks/use-workspace";
import { useChatReferences, getChatStore } from "@/workspace/hooks/use-session";
import { addReference, removeReference } from "@/workspace/api-client";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Input } from "@/shared/ui/input";
import { FileText, GitFork, Inbox, Check, Search } from "lucide-react";
import { cn } from "@/shared/utils";

export function ResourcesPanel() {
  const docs = useWorkspaceDocs();
  const graph = useWorkspaceGraph();
  const references = useChatReferences();
  const [search, setSearch] = useState("");

  const referenceIds = references.map((r) => r.id);

  const filtered = search
    ? docs.filter(
        (d) =>
          d.docId.toLowerCase().includes(search.toLowerCase()) ||
          d.fields.some((f) =>
            f.path.toLowerCase().includes(search.toLowerCase()),
          ),
      )
    : docs;

  const handleToggleReference = async (docId: string) => {
    const isRef = referenceIds.includes(docId);
    if (isRef) {
      getChatStore().removeReference(docId);
      await removeReference(docId);
    } else {
      const ref = { kind: "codoc", id: docId, label: docId };
      getChatStore().addReference(ref);
      await addReference(ref);
    }
  };

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground px-4">
        <Inbox className="h-8 w-8 opacity-30" />
        <p className="text-xs">No codocs in workspace</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-4 pb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Resources
        </h2>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-8 text-xs bg-sidebar-accent border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-2">
          {filtered.map((doc) => {
            const isRef = referenceIds.includes(doc.docId);
            return (
              <button
                key={doc.docId}
                onClick={() => handleToggleReference(doc.docId)}
                className={cn(
                  "w-full text-left rounded-md px-3 py-2 mb-0.5 flex items-center gap-2.5 transition-colors group",
                  isRef
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground",
                )}
              >
                <FileText
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isRef ? "text-foreground" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm font-medium truncate",
                      isRef && "text-foreground",
                    )}
                  >
                    {doc.docId}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {doc.fields.map((f) => f.path).join(" · ")}
                  </div>
                </div>
                {isRef && (
                  <Check className="h-3.5 w-3.5 flex-shrink-0 text-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer stats */}
      <div className="px-3 py-3 flex items-center gap-3 text-[11px] text-muted-foreground border-t border-sidebar-border">
        <span className="flex items-center gap-1">
          <GitFork className="h-3 w-3" />
          {graph.edges.length} dep{graph.edges.length !== 1 ? "s" : ""}
        </span>
        <span>
          {graph.nodes.length} field{graph.nodes.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// Backward compat export for DagGraphView which still uses the old name/props
export function CodocList(props: {
  references: string[];
  onAddReference: (docId: string) => void;
  onRemoveReference: (docId: string) => void;
}) {
  return <ResourcesPanel />;
}
