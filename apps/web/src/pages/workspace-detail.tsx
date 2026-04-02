import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getWorkspace } from "@/api/workspace.js";
import { listCodocs, getCodoc } from "@/api/codoc.js";
import { getGraph } from "@/api/graph.js";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CanvasPanel } from "@/components/canvas/canvas-panel";
import { CodocBrowser } from "@/components/codoc-browser";
import { ArrowLeft, FolderOpen, Plus } from "lucide-react";
import type {
  Workspace,
  CodocListItem,
  CodocDetail,
  GraphData,
} from "@/types.js";

export function WorkspaceDetailPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [codocs, setCodocs] = useState<CodocListItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [codocDetail, setCodocDetail] = useState<CodocDetail | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [codocLoading, setCodocLoading] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    getWorkspace(workspaceId).then(setWorkspace);
    listCodocs(workspaceId).then(setCodocs);
    getGraph(workspaceId).then(setGraph);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedPath) {
      setCodocDetail(null);
      return;
    }
    setCodocLoading(true);
    getCodoc(workspaceId, selectedPath)
      .then(setCodocDetail)
      .finally(() => setCodocLoading(false));
  }, [workspaceId, selectedPath]);

  const handleClearContext = useCallback(() => {
    setSelectedPath(null);
    setCodocDetail(null);
  }, []);

  if (!workspaceId) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <h1 className="font-semibold text-sm">
            {workspace?.name ?? "Loading..."}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBrowserOpen(true)}
          >
            <FolderOpen className="h-4 w-4 mr-1.5" />
            Codocs
            {codocs.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                {codocs.length}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            const thread = null; // will auto-create on first message
            void thread;
          }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Thread
          </Button>
        </div>
      </header>

      {/* Two-column resizable layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={55} minSize={30}>
          <ChatPanel
            workspaceId={workspaceId}
            selectedPath={selectedPath}
            onClearContext={handleClearContext}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={45} minSize={25}>
          <CanvasPanel
            codocDetail={codocDetail}
            selectedPath={selectedPath}
            loading={codocLoading}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Codoc browser Sheet */}
      <CodocBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        codocs={codocs}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />
    </div>
  );
}
