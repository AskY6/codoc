interface BookmarkCardProps {
  title?: string;
  url?: string;
  author?: string;
  savedAt?: string;
  status?: string;
  summary?: string;
  tags?: string[];
}

const statusColors: Record<string, string> = {
  read: "bg-green-100 text-green-700",
  unread: "bg-blue-100 text-blue-700",
};

export function BookmarkCard({ title, url, author, savedAt, status = "unread", summary, tags }: BookmarkCardProps) {
  return (
    <div className="not-prose rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-base font-semibold text-neutral-900 hover:text-blue-600">
              {title ?? "Untitled"}
            </a>
          ) : (
            <div className="text-base font-semibold text-neutral-900">{title ?? "Untitled"}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            {author && <span>{author}</span>}
            {savedAt && <><span>·</span><span>{savedAt}</span></>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[status] ?? statusColors.unread}`}>
          {status}
        </span>
      </div>
      {summary && <p className="mt-3 text-sm text-neutral-600 leading-relaxed">{summary}</p>}
      {Array.isArray(tags) && tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span key={i} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default BookmarkCard;
