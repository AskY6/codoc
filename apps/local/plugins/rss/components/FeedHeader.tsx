interface FeedHeaderProps {
  title?: string;
  url?: string;
  articleCount?: number;
  unreadCount?: number;
  refreshMinutes?: number;
  description?: string;
}

export function FeedHeader({ title, url, articleCount = 0, unreadCount = 0, refreshMinutes = 60, description }: FeedHeaderProps) {
  return (
    <div className="not-prose rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-neutral-900">{title ?? "Feed"}</div>
          {description && <div className="mt-1 text-sm text-neutral-500">{description}</div>}
        </div>
        <div className="flex shrink-0 gap-3 text-center">
          <div>
            <div className="text-xl font-semibold">{articleCount}</div>
            <div className="text-xs text-neutral-400">articles</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-blue-600">{unreadCount}</div>
            <div className="text-xs text-neutral-400">unread</div>
          </div>
        </div>
      </div>
      {url && (
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
          <span>↻ every {refreshMinutes}m</span>
          <span>·</span>
          <a href={url} target="_blank" rel="noreferrer" className="truncate hover:text-blue-500">{url}</a>
        </div>
      )}
    </div>
  );
}

export default FeedHeader;
