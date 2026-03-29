"use client";

import { useState, useCallback } from "react";
import { useWorkspaceInit, useWorkspaceDocs } from "@/workspace/hooks/use-workspace";
import { CodocList } from "./CodocList";
import { ChatPanel } from "./ChatPanel";
import { AgentsPanel } from "./AgentsPanel";
import { DagGraphView } from "./DagGraphView";

export type CenterView = "chat" | "graph";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import {
  Loader2,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  List,
  Network,
} from "lucide-react";
import { cn } from "@/shared/utils";

export function WorkspaceShell() {
  const { loading, error } = useWorkspaceInit();
  const docs = useWorkspaceDocs();
  const [references, setReferences] = useState<string[]>([]);
  const [centerView, setCenterView] = useState<CenterView>("chat");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const handleAddReference = useCallback((docId: string) => {
    setReferences((prev) =>
      prev.includes(docId) ? prev : [...prev, docId],
    );
  }, []);

  const handleRemoveReference = useCallback((docId: string) => {
    setReferences((prev) => prev.filter((id) => id !== docId));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Loading workspace…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <p className="text-sm font-medium text-destructive">
          Failed to load workspace
        </p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <header className="h-12 flex items-center px-4 gap-2 flex-shrink-0 border-b bg-background">
        <BookOpen className="h-4 w-4 text-foreground" />
        <span className="text-sm font-semibold tracking-tight">Cobook</span>

        <div className="flex-1" />

        {/* Center view switcher */}
        <div className="flex gap-0.5 rounded-md border border-border p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCenterView("chat")}
                className={cn(
                  "h-6 w-6 flex items-center justify-center rounded transition-colors",
                  centerView === "chat"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCenterView("graph")}
                className={cn(
                  "h-6 w-6 flex items-center justify-center rounded transition-colors",
                  centerView === "graph"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Network className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Dependency graph</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-4 mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLeftOpen((v) => !v)}
            >
              {leftOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {leftOpen ? "Hide codocs" : "Show codocs"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setRightOpen((v) => !v)}
            >
              {rightOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {rightOpen ? "Hide agents" : "Show agents"}
          </TooltipContent>
        </Tooltip>
      </header>

      {/* Three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar – Codoc list */}
        <aside
          className={cn(
            "flex-shrink-0 border-r bg-sidebar transition-[width] duration-200 overflow-hidden",
            leftOpen ? "w-72" : "w-0 border-r-0",
          )}
        >
          <CodocList
            references={references}
            onAddReference={handleAddReference}
            onRemoveReference={handleRemoveReference}
          />
        </aside>

        {/* Center – Chat or Graph */}
        <main className="flex-1 min-w-0">
          {centerView === "chat" ? (
            <ChatPanel />
          ) : (
            <DagGraphView
              references={references}
              onAddReference={handleAddReference}
              onRemoveReference={handleRemoveReference}
            />
          )}
        </main>

        {/* Right sidebar – Agents */}
        <aside
          className={cn(
            "flex-shrink-0 border-l bg-sidebar transition-[width] duration-200 overflow-hidden",
            rightOpen ? "w-72" : "w-0 border-l-0",
          )}
        >
          <AgentsPanel />
        </aside>
      </div>
    </div>
  );
}
