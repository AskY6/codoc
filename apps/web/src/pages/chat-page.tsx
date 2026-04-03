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
import {
  getThread,
  getThreadCodocs,
  getThreadAgents,
  listAgents,
  setThreadCodocs,
  setThreadAgents,
} from "@/api/chat.js";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CanvasPanel } from "@/components/canvas/canvas-panel";
import { CodocBrowser } from "@/components/codoc-browser";
import { AgentSelector } from "@/components/agent-selector";
import { CodocSubsetSelector } from "@/components/codoc-subset-selector";
import { ArrowLeft, FolderOpen } from "lucide-react";
import type {
  Workspace,
  CodocListItem,
  CodocDetail,
  ChatThread,
  AgentInfo,
} from "@/types.js";

export function ChatPage() {
  const { id: workspaceId, threadId } = useParams<{
    id: string;
    threadId: string;
  }>();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [codocs, setCodocs] = useState<CodocListItem[]>([]);
  const [selectedCodocIds, setSelectedCodocIds] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [codocDetail, setCodocDetail] = useState<CodocDetail | null>(null);
  const [codocLoading, setCodocLoading] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  useEffect(() => {
    if (!workspaceId || !threadId) return;
    getWorkspace(workspaceId).then(setWorkspace);
    listCodocs(workspaceId).then(setCodocs);
    listAgents().then(setAgents);
    getThread(threadId).then((result) => {
      if (result) setThread(result.thread);
    });
    getThreadCodocs(threadId).then((tcs) => {
      setSelectedCodocIds(tcs.map((tc) => tc.codocId));
    });
    getThreadAgents(threadId).then((tas) => {
      setSelectedAgentIds(tas.map((ta) => ta.agentId));
    });
  }, [workspaceId, threadId]);

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

  const handleAgentsChange = useCallback(
    async (agentIds: string[]) => {
      if (!threadId) return;
      setSelectedAgentIds(agentIds);
      await setThreadAgents(threadId, agentIds);
    },
    [threadId],
  );

  const handleCodocsChange = useCallback(
    async (codocIds: string[]) => {
      if (!threadId) return;
      setSelectedCodocIds(codocIds);
      await setThreadCodocs(threadId, codocIds);
    },
    [threadId],
  );

  if (!workspaceId || !threadId) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(`/workspace/${workspaceId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <h1 className="font-medium text-sm">
            {thread?.title ?? "Untitled chat"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <AgentSelector
            agents={agents}
            selectedIds={selectedAgentIds}
            onChange={handleAgentsChange}
          />
          <CodocSubsetSelector
            codocs={codocs}
            selectedIds={selectedCodocIds}
            onChange={handleCodocsChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBrowserOpen(true)}
          >
            <FolderOpen className="h-4 w-4 mr-1.5" />
            View codoc
          </Button>
        </div>
      </header>

      {/* Two-column resizable layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={55} minSize={30}>
          <ChatPanel
            workspaceId={workspaceId}
            threadId={threadId}
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
