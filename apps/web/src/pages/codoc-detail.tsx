import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCodoc, createCodoc, listCodocs } from "@/api/codoc.js";
import { createThread } from "@/api/chat.js";
import { generateCodocContent } from "@/lib/codoc-generators.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/codoc/status-badge";
import { CodocViewer } from "@/components/codoc/codoc-viewer";
import { ArrowLeft, MessageSquare } from "lucide-react";
import type { CodocDetail, ViewAction } from "@/types.js";

export function CodocDetailPage() {
  const { id: workspaceId, "*": codocPath } = useParams<{
    id: string;
    "*": string;
  }>();
  const navigate = useNavigate();

  const [codoc, setCodoc] = useState<CodocDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !codocPath) return;
    setLoading(true);
    getCodoc(workspaceId, codocPath)
      .then(setCodoc)
      .finally(() => setLoading(false));
  }, [workspaceId, codocPath]);

  async function handleNewChat() {
    if (!workspaceId || !codocPath) return;
    const codocs = await listCodocs(workspaceId);
    const match = codocs.find((c) => c.path === codocPath);
    const thread = await createThread(workspaceId, {
      codocIds: match ? [match.id] : [],
    });
    navigate(`/workspace/${workspaceId}/chat/${thread.id}`);
  }

  const handleViewAction = useCallback(
    async (action: ViewAction) => {
      if (action.type === "navigate" && workspaceId) {
        // Check if target codoc exists; if not, generate it
        try {
          await getCodoc(workspaceId, action.path);
        } catch {
          if (action.generate) {
            const content = generateCodocContent(
              action.generate.source,
              action.generate.params,
            );
            if (content) {
              await createCodoc(workspaceId, action.path, content);
            }
          }
        }
        navigate(`/workspace/${workspaceId}/codoc/${action.path}`);
      }
    },
    [workspaceId, navigate],
  );

  if (!workspaceId || !codocPath) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate(`/workspace/${workspaceId}`)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground truncate">
              {codocPath}
            </span>
            {codoc && <StatusBadge state={codoc.nodeState} />}
          </div>
          <Button size="sm" onClick={handleNewChat}>
            <MessageSquare className="h-4 w-4 mr-1.5" />
            New chat
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : codoc ? (
          <CodocViewer codoc={codoc} onAction={handleViewAction} />
        ) : (
          <p className="text-sm text-muted-foreground">Codoc not found</p>
        )}
      </div>
    </div>
  );
}
