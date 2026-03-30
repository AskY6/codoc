"use client";

import { useState, useRef, useEffect } from "react";
import {
  useWorkspaceDocs,
  useWorkspaceGraph,
} from "@/workspace/hooks/use-workspace";
import { useChatReferences, getChatStore } from "@/workspace/hooks/use-session";
import { addReference, removeReference } from "@/workspace/stores/api-client";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Input } from "@/shared/ui/input";
import { FileText, GitFork, MessageSquarePlus, Check, Search } from "lucide-react";
import { cn } from "@/shared/utils";
import { ConnectorHealth } from "./ConnectorHealth";

interface ResourcesPanelProps {
  selectedDocId?: string | null;
  onSelectDoc?: (docId: string) => void;
}

export function ResourcesPanel({ selectedDocId, onSelectDoc }: ResourcesPanelProps) {
  const docs = useWorkspaceDocs();
  const graph = useWorkspaceGraph();
  const references = useChatReferences();
  const [search, setSearch] = useState("");

  // Track newly appeared docs for highlight animation
  const prevDocIdsRef = useRef<Set<string>>(new Set());
  const [newDocIds, setNewDocIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevDocIdsRef.current;
    const currentIds = new Set(docs.map((d) => d.docId));
    const added = new Set<string>();
    for (const id of currentIds) {
      if (!prev.has(id)) added.add(id);
    }
    prevDocIdsRef.current = currentIds;

    if (added.size > 0) {
      setNewDocIds(added);
      const timer = setTimeout(() => setNewDocIds(new Set()), 2000);
      return () => clearTimeout(timer);
    }
  }, [docs]);

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

  const handleToggleReference = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground px-6 text-center">
        <MessageSquarePlus className="h-8 w-8 opacity-30" />
        <div>
          <p className="text-xs font-medium text-foreground/70">
            No documents yet
          </p>
          <p className="text-[11px] mt-1.5 leading-relaxed">
            Create a codoc in chat, or ask the agent to ingest external data
          </p>
        </div>
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
            placeholder="Search..."
            className="h-8 pl-8 text-xs bg-sidebar-accent border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-2">
          {filtered.map((doc) => {
            const isRef = referenceIds.includes(doc.docId);
            const isNew = newDocIds.has(doc.docId);
            const isSelected = selectedDocId === doc.docId;
            return (
              <button
                key={doc.docId}
                onClick={() => onSelectDoc?.(doc.docId)}
                className={cn(
                  "w-full text-left rounded-md px-3 py-2 mb-0.5 flex items-center gap-2.5 transition-colors group",
                  isSelected
                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                    : isRef
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/60 text-sidebar-foreground",
                  isNew && "animate-highlight-fade",
                )}
              >
                <FileText
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isSelected
                      ? "text-primary"
                      : isRef
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm font-medium truncate",
                      (isRef || isSelected) && "text-foreground",
                    )}
                  >
                    {doc.docId}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {doc.fields.map((f) => f.path).join(" · ")}
                  </div>
                </div>
                <button
                  onClick={(e) => handleToggleReference(e, doc.docId)}
                  className={cn(
                    "h-5 w-5 flex items-center justify-center rounded transition-opacity flex-shrink-0",
                    isRef
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100",
                  )}
                  title={isRef ? "Remove from chat" : "Add to chat"}
                >
                  <Check className="h-3 w-3" />
                </button>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Connector health */}
      <ConnectorHealth />

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
