import { useEffect, useState } from "react";
import { Rss } from "lucide-react";
import { getCodoc } from "@/api/codoc.js";
import type { CodocListItem } from "@/types.js";

interface Props {
  workspaceId: string;
  codocs: CodocListItem[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

interface FeedInfo {
  path: string;
  title: string;
  unreadCount: number;
}

export function RssFeedList({
  workspaceId,
  codocs,
  selectedPath,
  onSelectPath,
}: Props) {
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);

  const rssCodocs = codocs.filter(
    (c) =>
      c.path.startsWith("rss/") &&
      c.meta.tags?.includes("rss") &&
      !c.meta.tags?.includes("dashboard") &&
      !c.path.startsWith("rss/summaries/"),
  );

  useEffect(() => {
    if (rssCodocs.length === 0) {
      setFeeds([]);
      return;
    }

    Promise.all(
      rssCodocs.map(async (c) => {
        try {
          const detail = await getCodoc(workspaceId, c.path);
          const data = detail.resolvedData;
          let unreadCount = 0;
          if (data) {
            // Find the articles field in resolved data
            const articlesKey = Object.keys(data).find((k) =>
              k.endsWith("articles"),
            );
            if (articlesKey) {
              const raw = data[articlesKey];
              const articles = (
                raw && typeof raw === "object" && "value" in raw
                  ? (raw as { value: unknown }).value
                  : raw
              ) as Array<{ readAt?: string | null }> | undefined;
              if (Array.isArray(articles)) {
                unreadCount = articles.filter((a) => !a.readAt).length;
              }
            }
          }
          return {
            path: c.path,
            title: c.meta.title ?? c.path,
            unreadCount,
          };
        } catch {
          return { path: c.path, title: c.meta.title ?? c.path, unreadCount: 0 };
        }
      }),
    ).then(setFeeds);
  }, [workspaceId, rssCodocs.length]);

  if (feeds.length === 0) return null;

  return (
    <div className="px-4 pb-2">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Rss className="h-3 w-3" />
        RSS Feeds
      </h2>
      <div className="space-y-0.5">
        {feeds.map((feed) => (
          <button
            key={feed.path}
            type="button"
            onClick={() => onSelectPath(feed.path)}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center justify-between gap-2 ${
              feed.path === selectedPath
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
            }`}
          >
            <span className="truncate">{feed.title}</span>
            {feed.unreadCount > 0 && (
              <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center">
                {feed.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
