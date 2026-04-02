import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getWorkspace, getWorkspaceStatus } from "@/api/workspace.js";
import { listCodocs } from "@/api/codoc.js";
import { getGraph } from "@/api/graph.js";
import { listThreads, createThread } from "@/api/chat.js";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import {
  ArrowLeft,
  Plus,
  MessageSquare,
  FileText,
  FolderOpen,
} from "lucide-react";
import type {
  Workspace,
  WorkspaceStatus,
  CodocListItem,
  ChatThread,
  GraphData,
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    Promise.all([
      getWorkspace(workspaceId).then(setWorkspace),
      getWorkspaceStatus(workspaceId).then(setStatus),
      listCodocs(workspaceId).then(setCodocs),
      listThreads(workspaceId).then(setThreads),
      getGraph(workspaceId).then(setGraph),
    ]).finally(() => setLoading(false));
  }, [workspaceId]);

  async function handleNewThread() {
    if (!workspaceId) return;
    const thread = await createThread(workspaceId);
    navigate(`/workspace/${workspaceId}/chat/${thread.id}`);
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
            <h1 className="text-xl font-semibold">{workspace?.name}</h1>
          </div>
          <Button size="sm" onClick={handleNewThread}>
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
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Chats
              </h2>
            </div>
            {threads.length === 0 ? (
              <Card className="flex flex-col items-center justify-center py-10 gap-3">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No chats yet</p>
                <Button size="sm" variant="outline" onClick={handleNewThread}>
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
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
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
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
                            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1">{c.path}</span>
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
      </div>
    </div>
  );
}
