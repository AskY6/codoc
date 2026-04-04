import { useEffect, useState, useCallback, useRef, type KeyboardEvent } from "react";
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
  updateThread,
} from "@/api/chat.js";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatPanelHandle } from "@/components/chat/chat-panel";
import { CanvasPanel } from "@/components/canvas/canvas-panel";
import { AgentSelector } from "@/components/agent-selector";
import { CodocSubsetSelector } from "@/components/codoc-subset-selector";
import { ArrowLeft } from "lucide-react";
import type {
  Workspace,
  CodocListItem,
  CodocDetail,
  ChatThread,
  AgentInfo,
  ViewAction,
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const chatRef = useRef<ChatPanelHandle>(null);

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
      // Auto-view first codoc when canvas is empty
      if (!selectedPath && codocIds.length > 0) {
        const first = codocs.find((c) => c.id === codocIds[0]);
        if (first) setSelectedPath(first.path);
      }
    },
    [threadId, selectedPath, codocs],
  );

  const handleTitleClick = useCallback(() => {
    setTitleDraft(thread?.title ?? "");
    setEditingTitle(true);
  }, [thread?.title]);

  const handleTitleSave = useCallback(async () => {
    setEditingTitle(false);
    if (!threadId) return;
    const trimmed = titleDraft.trim();
    if (trimmed !== (thread?.title ?? "")) {
      const updated = await updateThread(threadId, trimmed ? { title: trimmed } : {});
      setThread(updated);
    }
  }, [threadId, titleDraft, thread?.title]);

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") setEditingTitle(false);
    },
    [handleTitleSave],
  );

  const handleTitleUpdate = useCallback((title: string) => {
    setThread((prev) => prev ? { ...prev, title } : prev);
  }, []);

  const handleViewAction = useCallback((action: ViewAction) => {
    if (action.type === "chat") {
      chatRef.current?.send(action.prompt);
    }
  }, []);

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
          {editingTitle ? (
            <input
              className="font-medium text-sm bg-transparent border-b border-foreground/30 outline-none px-0.5"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              autoFocus
            />
          ) : (
            <button
              className="font-medium text-sm hover:text-foreground/70 transition-colors cursor-text"
              onClick={handleTitleClick}
            >
              {thread?.title ?? "Untitled chat"}
            </button>
          )}
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
        </div>
      </header>

      {/* Two-column resizable layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={55} minSize={30}>
          <ChatPanel
            ref={chatRef}
            workspaceId={workspaceId}
            threadId={threadId}
            agents={agents}
            selectedPath={selectedPath}
            onClearContext={handleClearContext}
            onTitleUpdate={handleTitleUpdate}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={45} minSize={25}>
          <CanvasPanel
            codocs={codocs.filter((c) => selectedCodocIds.includes(c.id))}
            codocDetail={codocDetail}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
            onAction={handleViewAction}
            loading={codocLoading}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
