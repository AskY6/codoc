"use client";

import { useState } from "react";
import { useWorkspaceInit } from "@/hooks/use-workspace";
import { GraphView } from "./GraphView";
import { DocView } from "./DocView";
import { ChangeFeed } from "./ChangeFeed";

export function WorkspaceShell() {
  const { loading, error } = useWorkspaceInit();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-destructive">
        <div className="text-center">
          <p className="font-medium">Failed to load workspace</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* Left panel: doc list */}
      <div className="w-64 border-r flex-shrink-0">
        <GraphView selectedDocId={selectedDocId} onSelectDoc={setSelectedDocId} />
      </div>

      {/* Center: doc view */}
      <div className="flex-1 min-w-0">
        {selectedDocId ? (
          <DocView key={selectedDocId} docId={selectedDocId} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a document
          </div>
        )}
      </div>

      {/* Right panel: change feed */}
      <div className="w-72 border-l flex-shrink-0">
        <ChangeFeed onSelectDoc={setSelectedDocId} />
      </div>
    </div>
  );
}
