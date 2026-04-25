interface Article {
  title?: string;
  link?: string;
  pubDate?: string;
  readAt?: string | null;
}

interface ArticleListProps {
  items?: Article[];
  emptyText?: string;
}

export function ArticleList({ items, emptyText = "No articles yet — ask the agent to refresh this feed." }: ArticleListProps) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-400">{emptyText}</div>;
  }

  return (
    <div className="not-prose divide-y divide-neutral-100">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 py-2.5">
          <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-neutral-300" : "bg-blue-500"}`} />
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
        </div>
      ))}
    </div>
  );
}

export default ArticleList;
