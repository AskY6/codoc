import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getWorkspace, getWorkspaceStatus } from "@/api/workspace.js";
import { listCodocs, getCodoc, deleteCodoc } from "@/api/codoc.js";
import { getGraph } from "@/api/graph.js";
import {
  listThreads,
  createThread,
  deleteThread,
  listAgents,
  getWorkspaceAgents,
  setWorkspaceAgents,
} from "@/api/chat.js";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { CodocViewer } from "@/components/codoc-viewer";
import {
  ArrowLeft,
  Bot,
  Plus,
  MessageSquare,
  FileText,
  FolderOpen,
  Eye,
  Trash2,
} from "lucide-react";
import type {
  Workspace,
  WorkspaceStatus,
  CodocListItem,
  CodocDetail,
  ChatThread,
  GraphData,
  AgentInfo,
} from "@/types.js";
import { GraphView } from "@/components/graph-view";

export function WorkspaceDetailPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [codocs, setCodocs] = useState<CodocListItem[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [wsAgentIds, setWsAgentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteCodocPath, setConfirmDeleteCodocPath] = useState<string | null>(null);

  // View dialog state
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewCodoc, setViewCodoc] = useState<CodocDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // New chat dialog state
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatAgentIds, setNewChatAgentIds] = useState<string[]>([]);
  const [newChatCodocIds, setNewChatCodocIds] = useState<string[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    Promise.all([
      getWorkspace(workspaceId).then(setWorkspace),
      getWorkspaceStatus(workspaceId).then(setStatus),
      listCodocs(workspaceId).then(setCodocs),
      listThreads(workspaceId).then(setThreads),
      getGraph(workspaceId).then(setGraph),
      listAgents().then(setAgents),
      getWorkspaceAgents(workspaceId).then((wa) => setWsAgentIds(wa.map((a) => a.agentId))),
    ]).finally(() => setLoading(false));
  }, [workspaceId]);

  function openNewChatDialog(preselectedCodocId?: string) {
    // Pre-fill with workspace defaults (or all if no defaults)
    setNewChatAgentIds(wsAgentIds.length > 0 ? [...wsAgentIds] : agents.map((a) => a.id));
    setNewChatCodocIds(preselectedCodocId ? [preselectedCodocId] : []);
    setNewChatOpen(true);
  }

  async function handleCreateThread() {
    if (!workspaceId) return;
    const thread = await createThread(workspaceId, {
      agentIds: newChatAgentIds,
      codocIds: newChatCodocIds,
    });
    setNewChatOpen(false);
    navigate(`/workspace/${workspaceId}/chat/${thread.id}`);
  }

  async function handleToggleWsAgent(agentId: string) {
    if (!workspaceId) return;
    const next = wsAgentIds.includes(agentId)
      ? wsAgentIds.filter((id) => id !== agentId)
      : [...wsAgentIds, agentId];
    setWsAgentIds(next);
    await setWorkspaceAgents(workspaceId, next);
  }

  function handleDeleteThread(e: React.MouseEvent, threadId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (confirmDeleteId === threadId) {
      deleteThread(threadId).then(() => {
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
      });
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(threadId);
    }
  }

  function handleDeleteCodoc(e: React.MouseEvent, codocPath: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!workspaceId) return;
    if (confirmDeleteCodocPath === codocPath) {
      deleteCodoc(workspaceId, codocPath).then(() => {
        setCodocs((prev) => prev.filter((c) => c.path !== codocPath));
      });
      setConfirmDeleteCodocPath(null);
    } else {
      setConfirmDeleteCodocPath(codocPath);
    }
  }

  async function handleViewCodoc(codocPath: string) {
    if (!workspaceId) return;
    setViewDialogOpen(true);
    setViewLoading(true);
    setViewCodoc(null);
    try {
      const detail = await getCodoc(workspaceId, codocPath);
      setViewCodoc(detail);
    } finally {
      setViewLoading(false);
    }
  }

  if (!workspaceId) return null;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <h1 className="text-xl font-medium">{workspace?.name}</h1>
          </div>
          <Button size="sm" onClick={() => openNewChatDialog()}>
            <Plus className="h-4 w-4 mr-1.5" />
            New chat
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Workspace Info */}
        <section className="flex items-center gap-4">
          <Badge variant="secondary">
            {status?.codocCount ?? 0} codocs
          </Badge>
          <Badge variant="secondary">
            {threads.length} chats
          </Badge>
          {status?.states &&
            Object.entries(status.states).map(([state, count]) => (
              <Badge key={state} variant="outline">
                {state}: {count}
              </Badge>
            ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Chat List */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Chats
              </h2>
            </div>
            {threads.length === 0 ? (
              <Card className="flex flex-col items-center justify-center py-10 gap-3">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No chats yet</p>
                <Button size="sm" variant="outline" onClick={() => openNewChatDialog()}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Start a chat
                </Button>
              </Card>
            ) : (
              <ScrollArea className="max-h-80">
                <div className="space-y-2">
                  {threads.map((t) => (
                    <Link
                      key={t.id}
                      to={`/workspace/${workspaceId}/chat/${t.id}`}
                    >
                      <Card className="group hover:shadow-md transition-shadow cursor-pointer">
                        <CardHeader className="py-3 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <CardTitle className="text-sm truncate">
                                {t.title ?? "Untitled"}
                              </CardTitle>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {new Date(t.updatedAt).toLocaleDateString()}
                              </span>
                              {confirmDeleteId === t.id ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => handleDeleteThread(e, t.id)}
                                  onBlur={() => setConfirmDeleteId(null)}
                                >
                                  Delete?
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => handleDeleteThread(e, t.id)}
                                  title="Delete chat"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            )}
          </section>

          {/* Codoc List / Graph */}
          <section>
            <Tabs defaultValue="list">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Codocs
                </h2>
                <TabsList>
                  <TabsTrigger value="list">List</TabsTrigger>
                  <TabsTrigger value="graph">Graph</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="list">
                {codocs.length === 0 ? (
                  <Card className="flex flex-col items-center justify-center py-10 gap-3">
                    <FolderOpen className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No codocs yet</p>
                  </Card>
                ) : (
                  <Card>
                    <ScrollArea className="max-h-80">
                      <div className="p-2">
                        {codocs.map((c) => (
                          <div
                            key={c.path}
                            className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1">{c.path}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleViewCodoc(c.path)}
                                  title="View"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => openNewChatDialog(c.id)}
                                  title="New chat"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              {confirmDeleteCodocPath === c.path ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => handleDeleteCodoc(e, c.path)}
                                  onBlur={() => setConfirmDeleteCodocPath(null)}
                                >
                                  Delete?
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => handleDeleteCodoc(e, c.path)}
                                  title="Delete codoc"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                </Button>
                              )}
                            </div>
                            <StatusBadge state={c.nodeState} />
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="graph">
                <Card className="overflow-hidden">
                  {graph && graph.nodes.length > 0 ? (
                    <GraphView graph={graph} />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <p className="text-sm text-muted-foreground">No graph data</p>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {/* Agents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Agents
            </h2>
            <span className="text-xs text-muted-foreground">
              {wsAgentIds.length > 0
                ? `${wsAgentIds.length} enabled as default`
                : "All enabled by default"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => {
              const enabled = wsAgentIds.length === 0 || wsAgentIds.includes(a.id);
              return (
                <Card
                  key={a.id}
                  className={`cursor-pointer transition-colors ${
                    enabled ? "" : "opacity-50"
                  }`}
                  onClick={() => handleToggleWsAgent(a.id)}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-sm">{a.name}</CardTitle>
                        <p className="text-xs text-muted-foreground truncate">{a.description}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={enabled}
                        readOnly
                        className="h-3.5 w-3.5 shrink-0"
                      />
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      {/* New Chat Dialog */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Agent selection */}
            <div>
              <h3 className="text-sm font-medium mb-2">Agents</h3>
              <div className="space-y-1">
                {agents.map((a) => {
                  const checked = newChatAgentIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() =>
                        setNewChatAgentIds(
                          checked
                            ? newChatAgentIds.filter((id) => id !== a.id)
                            : [...newChatAgentIds, a.id],
                        )
                      }
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        checked ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <input type="checkbox" checked={checked} readOnly className="h-3.5 w-3.5 shrink-0" />
                      <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{a.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Codoc selection */}
            {codocs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">Codocs</h3>
                <ScrollArea className="max-h-40">
                  <div className="space-y-1">
                    {codocs.map((c) => {
                      const checked = newChatCodocIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() =>
                            setNewChatCodocIds(
                              checked
                                ? newChatCodocIds.filter((id) => id !== c.id)
                                : [...newChatCodocIds, c.id],
                            )
                          }
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                            checked ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <input type="checkbox" checked={checked} readOnly className="h-3.5 w-3.5 shrink-0" />
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-sm truncate flex-1">{c.path}</span>
                          <StatusBadge state={c.nodeState} />
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleCreateThread} disabled={newChatAgentIds.length === 0}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Codoc Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewCodoc?.ast?.meta?.title ?? viewCodoc?.path ?? "Codoc"}</DialogTitle>
          </DialogHeader>
          {viewLoading ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : viewCodoc ? (
            <CodocViewer codoc={viewCodoc} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
