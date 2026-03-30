"use client";

import { useState, useCallback } from "react";
import { useWorkspaceInit } from "@/workspace/hooks/use-workspace";
import { useChatReferences, getChatStore } from "@/workspace/hooks/use-session";
import { usePendingIntentCount } from "@/workspace/hooks/use-intent-queue";
import { addReference, removeReference } from "@/workspace/stores/api-client";
import { ResourcesPanel } from "./codoc/CodocList";
import { SessionDetail } from "./codoc/SessionDetail";
import { ChatArea } from "./chat/ChatArea";
import { ParticipantsPanel } from "./AgentsPanel";
import { DagGraphView } from "./DagGraphView";
import { IntentQueuePanel } from "./IntentQueuePanel";

export type CenterView = "chat" | "graph" | "doc";
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
  FileText,
  Zap,
} from "lucide-react";
import { cn } from "@/shared/utils";

export function WorkspaceShell() {
  const { loading, error } = useWorkspaceInit();
  const references = useChatReferences();
  const pendingIntentCount = usePendingIntentCount();
  const [centerView, setCenterView] = useState<CenterView>("chat");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [intentQueueOpen, setIntentQueueOpen] = useState(false);

  const handleSelectDoc = useCallback((docId: string) => {
    setSelectedDocId(docId);
    setCenterView("doc");
  }, []);

  // DagGraphView still uses the old callback interface for reference toggling
  const referenceIds = references.map((r) => r.id);

  const handleAddReference = useCallback(async (docId: string) => {
    const ref = { kind: "codoc", id: docId, label: docId };
    getChatStore().addReference(ref);
    await addReference(ref);
  }, []);

  const handleRemoveReference = useCallback(async (docId: string) => {
    getChatStore().removeReference(docId);
    await removeReference(docId);
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

        {/* Intent Queue badge */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={intentQueueOpen ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5 relative"
              onClick={() => setIntentQueueOpen((v) => !v)}
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="text-xs">Intents</span>
              {pendingIntentCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold rounded-full h-4 min-w-4 flex items-center justify-center px-1">
                  {pendingIntentCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {pendingIntentCount > 0
              ? `${pendingIntentCount} pending intent${pendingIntentCount > 1 ? "s" : ""}`
              : "Intent queue"}
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-4 mx-1" />

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
          {selectedDocId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCenterView("doc")}
                  className={cn(
                    "h-6 w-6 flex items-center justify-center rounded transition-colors",
                    centerView === "doc"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Document</TooltipContent>
            </Tooltip>
          )}
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
            {leftOpen ? "Hide resources" : "Show resources"}
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
        {/* Left sidebar – Resources */}
        <aside
          className={cn(
            "flex-shrink-0 border-r bg-sidebar transition-[width] duration-200 overflow-hidden",
            leftOpen ? "w-72" : "w-0 border-r-0",
          )}
        >
          <ResourcesPanel
            selectedDocId={selectedDocId}
            onSelectDoc={handleSelectDoc}
          />
        </aside>

        {/* Center – Chat, Graph, or Doc */}
        <main className="flex-1 min-w-0">
          {centerView === "doc" && selectedDocId ? (
            <SessionDetail
              docId={selectedDocId}
              onClose={() => {
                setSelectedDocId(null);
                setCenterView("chat");
              }}
            />
          ) : centerView === "graph" ? (
            <DagGraphView
              references={referenceIds}
              onAddReference={handleAddReference}
              onRemoveReference={handleRemoveReference}
            />
          ) : (
            <ChatArea />
          )}
        </main>

        {/* Intent Queue Panel (overlay on right side when open) */}
        {intentQueueOpen && (
          <aside className="flex-shrink-0 w-80 border-l bg-sidebar overflow-hidden">
            <IntentQueuePanel onClose={() => setIntentQueueOpen(false)} />
          </aside>
        )}

        {/* Right sidebar – Agents */}
        <aside
          className={cn(
            "flex-shrink-0 border-l bg-sidebar transition-[width] duration-200 overflow-hidden",
            rightOpen && !intentQueueOpen ? "w-72" : "w-0 border-l-0",
          )}
        >
          <ParticipantsPanel />
        </aside>
      </div>
    </div>
  );
}
