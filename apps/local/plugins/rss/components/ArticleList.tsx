import { useState } from "react";

interface Article {
  title?: string;
  link?: string;
  pubDate?: string;
  readAt?: string | null;
  starred?: boolean;
}

interface ArticleListProps {
  items?: Article[];
  emptyText?: string;
  /** Required for interactive buttons (read/star). */
  codocPath?: string;
  /** Required for interactive buttons (read/star). */
  fieldName?: string;
}

export function ArticleList({
  items,
  emptyText = "No articles yet — ask the agent to refresh this feed.",
  codocPath,
  fieldName,
}: ArticleListProps) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-400">{emptyText}</div>;
  }

  const interactive = !!(codocPath && fieldName);

  return (
    <div className="not-prose divide-y divide-neutral-100">
      {items.map((item, i) => (
        <ArticleRow
          key={i}
          item={item}
          index={i}
          interactive={interactive}
          codocPath={codocPath}
          fieldName={fieldName}
        />
      ))}
    </div>
  );
}

function ArticleRow({
  item,
  index,
  interactive,
  codocPath,
  fieldName,
}: {
  item: Article;
  index: number;
  interactive: boolean;
  codocPath?: string;
  fieldName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [localRead, setLocalRead] = useState(item.readAt);
  const [localStarred, setLocalStarred] = useState(item.starred ?? false);

  const isRead = !!localRead;

  async function patchArticle(patch: { readAt?: string | null; starred?: boolean }) {
    if (!codocPath || !fieldName || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/codoc/${encodeURI(codocPath)}/articles/${encodeURIComponent(fieldName)}/${index}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (res.ok) {
        if ("readAt" in patch) setLocalRead(patch.readAt ?? null);
        if ("starred" in patch) setLocalStarred(patch.starred ?? false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group flex items-start gap-3 py-2.5">
      {/* Read indicator — clickable when interactive */}
      {interactive ? (
        <button
          type="button"
          title={isRead ? "Mark unread" : "Mark read"}
          disabled={busy}
          onClick={() => patchArticle({ readAt: isRead ? null : new Date().toISOString() })}
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full transition-colors ${isRead ? "bg-neutral-300 hover:bg-blue-400" : "bg-blue-500 hover:bg-blue-700"} ${busy ? "opacity-50" : "cursor-pointer"}`}
        />
      ) : (
        <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead ? "bg-neutral-300" : "bg-blue-500"}`} />
      )}

      <div className="min-w-0 flex-1">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noreferrer" className="text-sm font-medium text-neutral-900 hover:text-blue-600">
            {item.title ?? "Untitled"}
          </a>
        ) : (
          <span className="text-sm font-medium text-neutral-900">{item.title ?? "Untitled"}</span>
        )}
        {item.pubDate && (
          <div className="mt-0.5 text-xs text-neutral-400">{new Date(item.pubDate).toLocaleDateString()}</div>
        )}
      </div>

      {/* Star button */}
      {interactive && (
        <button
          type="button"
          title={localStarred ? "Unstar" : "Star"}
          disabled={busy}
          onClick={() => patchArticle({ starred: !localStarred })}
          className={`mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 ${localStarred ? "!opacity-100" : ""} ${busy ? "opacity-50" : "cursor-pointer"}`}
        >
          {localStarred ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-300 hover:text-amber-400">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

export default ArticleList;
