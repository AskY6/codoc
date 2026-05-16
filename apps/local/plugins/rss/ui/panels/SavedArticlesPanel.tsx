import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api.ts";
import type { RssStarredArticle } from "@/api.ts";
import { subscribe } from "@/lib/event-bus.ts";

export function SavedArticlesPanel() {
  const [articles, setArticles] = useState<RssStarredArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.rss.saved();
      setArticles(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Reload when workspace data changes (via shared event bus, single SSE in App).
  useEffect(() => subscribe("workspace-updated", () => { void load(); }), [load]);

  const sources = useMemo(
    () => [...new Set(articles.map((a) => a.sourceTitle || a.sourceSlug))].sort(),
    [articles],
  );

  const filtered = useMemo(() => {
    let result = articles;
    if (sourceFilter) {
      result = result.filter(
        (a) => (a.sourceTitle || a.sourceSlug) === sourceFilter,
      );
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.sourceTitle ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [articles, search, sourceFilter]);

  async function handleUnsave(article: RssStarredArticle) {
    if (!article.articleId) return;
    setTogglingId(article.articleId);
    try {
      await api.rss.updateArticle(article.articleId, { starred: false });
      await load();
    } catch {
      // Silently fail — the starred state stays until the next reload.
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-800">Saved Articles</span>
          {!loading && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500 uppercase">
              {articles.length}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-white px-4 py-2">
        <input
          type="text"
          placeholder="Search saved articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {sources.length > 1 && (
          <select
            value={sourceFilter ?? ""}
            onChange={(e) => setSourceFilter(e.target.value || null)}
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-neutral-400">
            <span className="text-sm">Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
            <BookmarkEmptyIcon />
            <p className="mt-3 text-sm font-medium">
              {articles.length === 0 ? "No saved articles" : "No matches"}
            </p>
            <p className="mt-1 text-xs opacity-60">
              {articles.length === 0
                ? "Star articles from your feeds to see them here."
                : "Try a different search or filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((article) => (
              <div
                key={article.articleId ?? article.link}
                className="group rounded-lg border border-neutral-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <a
                      href={article.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-neutral-800 hover:text-blue-600 hover:underline line-clamp-1"
                    >
                      {article.title}
                    </a>

                    <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-400">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-500">
                        {article.sourceTitle || article.sourceSlug}
                      </span>
                      {article.pubDate && (
                        <span>{formatDate(article.pubDate)}</span>
                      )}
                    </div>

                    {article.description && (
                      <p className="mt-1.5 text-xs text-neutral-500 line-clamp-2">
                        {article.description}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    title="Remove from saved"
                    disabled={togglingId === article.articleId}
                    onClick={() => handleUnsave(article)}
                    className="shrink-0 rounded p-1.5 text-amber-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-amber-50 disabled:opacity-40"
                  >
                    <StarFilledIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function BookmarkEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-200">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function StarFilledIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
