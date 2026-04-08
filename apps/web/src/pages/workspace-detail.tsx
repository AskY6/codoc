import { useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/codoc/status-badge";
import { CodocViewer } from "@/components/codoc/codoc-viewer";
import { buildTree, TreeItem } from "@/components/codoc/codoc-browser";
import {
  ArrowLeft,
  Bot,
  Plus,
  MessageSquare,
  FileText,
  FolderOpen,
  Search,
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
import { GraphView } from "@/components/codoc/graph-view";

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

  const [filterState, setFilterState] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
  const [quickChatLoading, setQuickChatLoading] = useState(false);

  // Agent management dialog state
  const [agentBrowserOpen, setAgentBrowserOpen] = useState(false);

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

  async function handleQuickChat(codocId: string) {
    if (!workspaceId || quickChatLoading) return;
    setQuickChatLoading(true);
    try {
      const thread = await createThread(workspaceId, {
        codocIds: [codocId],
      });
      navigate(`/workspace/${workspaceId}/chat/${thread.id}`);
    } finally {
      setQuickChatLoading(false);
    }
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

  function handleNavigateCodoc(codocPath: string) {
    navigate(`/workspace/${workspaceId}/codoc/${codocPath}`);
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

  const filteredCodocs = useMemo(() => {
    let result = codocs;
    if (filterState) {
      result = result.filter((c) => c.nodeState === filterState);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) => c.path.toLowerCase().includes(q) || (c.meta.title?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [codocs, filterState, searchQuery]);
  const tree = useMemo(() => buildTree(filteredCodocs), [filteredCodocs]);

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

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
        {/* Recent Chats — horizontal scrollable cards */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Recent chats
            </h2>
            <Badge variant="secondary" className="text-xs">
              {threads.length}
            </Badge>
          </div>
          {threads.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No chats yet</p>
              <Button size="sm" variant="link" className="h-auto p-0 text-sm" onClick={() => openNewChatDialog()}>
                Start your first chat
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {threads.map((t) => (
                <Link
                  key={t.id}
                  to={`/workspace/${workspaceId}/chat/${t.id}`}
                  className="group flex items-center gap-2 py-1 px-2 -mx-2 rounded-md text-sm hover:bg-muted transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.title ?? "Untitled"}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">{new Date(t.updatedAt).toLocaleDateString()}</span>
                  {confirmDeleteId === t.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-5 text-xs px-1.5 shrink-0"
                      onClick={(e) => handleDeleteThread(e, t.id)}
                      onBlur={() => setConfirmDeleteId(null)}
                    >
                      Delete?
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 shrink-0"
                      onClick={(e) => handleDeleteThread(e, t.id)}
                      title="Delete chat"
                    >
                      <Trash2 className="h-3 w-3 hover:text-destructive" />
                    </Button>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Codocs — full width with tabs */}
        <section>
          <Tabs defaultValue="list">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Codocs
                </h2>
                {status?.states &&
                  Object.entries(status.states).map(([state, count]) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className={`text-xs cursor-pointer transition-colors ${
                        filterState === state ? "bg-primary/10 border-primary text-primary" : ""
                      }`}
                      onClick={() => setFilterState(filterState === state ? null : state)}
                    >
                      {state}: {count}
                    </Badge>
                  ))}
              </div>
              <TabsList>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="graph">Graph</TabsTrigger>
              </TabsList>
            </div>

            {codocs.length > 8 && (
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search codocs…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            )}

            <TabsContent value="list">
              {codocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="rounded-full bg-muted p-4">
                    <FolderOpen className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No codocs yet</p>
                </div>
              ) : (
                <Card className="py-1">
                  <TreeItem
                    node={tree}
                    depth={0}
                    selectedPath={null}
                    onSelect={handleNavigateCodoc}
                    renderActions={(path) => {
                      const codoc = codocs.find((c) => c.path === path);
                      if (!codoc) return null;
                      return (
                        <span className="flex items-center gap-1 opacity-0 group-hover/leaf:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={quickChatLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickChat(codoc.id);
                            }}
                            title="New chat"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </Button>
                          {confirmDeleteCodocPath === path ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCodoc(e, path);
                              }}
                              onBlur={() => setConfirmDeleteCodocPath(null)}
                            >
                              Delete?
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCodoc(e, path);
                              }}
                              title="Delete codoc"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </Button>
                          )}
                        </span>
                      );
                    }}
                  />
                </Card>
              )}
            </TabsContent>

            <TabsContent value="graph">
              <Card className="overflow-hidden">
                {graph && graph.nodes.length > 0 ? (
                  <GraphView graph={graph} onNodeClick={handleViewCodoc} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <p className="text-sm text-muted-foreground">No graph data</p>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* Agents — workspace-scoped */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Agents
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setAgentBrowserOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Browse all
            </Button>
          </div>
          {(() => {
            const wsAgents = wsAgentIds.length > 0
              ? agents.filter((a) => wsAgentIds.includes(a.id))
              : agents;
            return wsAgents.length === 0 ? (
              <div className="flex items-center gap-3 py-2">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No agents enabled</p>
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={() => setAgentBrowserOpen(true)}
                >
                  Add agents
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {wsAgents.map((a) => (
                  <Card key={a.id}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-start gap-2">
                        <Bot className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-sm">{a.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">{a.description}</p>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            );
          })()}
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
                      <Checkbox checked={checked} readOnly className="size-3.5" />
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
                          <Checkbox checked={checked} readOnly className="size-3.5" />
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

      {/* Browse Agents Dialog */}
      <Dialog open={agentBrowserOpen} onOpenChange={setAgentBrowserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>All agents</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2">
            {agents.map((a) => {
              const enabled = wsAgentIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => handleToggleWsAgent(a.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    enabled ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Checkbox checked={enabled} readOnly className="size-3.5" />
                  <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{a.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.description}</div>
                  </div>
                </button>
              );
            })}
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
