import { SourceBadge, formatRelative, cleanSummary } from "./SourceBadge";

interface Item {
  title?: string;
  source?: string;
  link?: string;
  summary?: string;
  pubDate?: string;
}

interface DigestListProps {
  items?: Item[];
  skip?: number;
  heading?: string;
}

export function DigestList({ items = [], skip = 0, heading }: DigestListProps) {
  const rows = items.slice(skip);
  if (rows.length === 0) return null;

  return (
    <div className="not-prose mb-8">
      {heading && (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          {heading}
        </div>
      )}
      <div className="divide-y divide-neutral-100 border-t border-neutral-100">
        {rows.map((item, i) => (
          <Row key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

function Row({ item }: { item: Item }) {
  const cleaned = cleanSummary(item.summary);
  const summary = cleaned && cleaned !== item.title ? cleaned : "";

  const onDiscuss = () => {
    const w = (typeof window !== "undefined" ? window : ({} as Window)) as Window & {
      codoc?: { discuss(a: Item): Promise<void> };
    };
    void w.codoc?.discuss(item);
  };

  return (
    <div className="group flex items-start gap-3 py-3">
      <SourceBadge source={item.source} compact />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-medium leading-snug text-neutral-900">
            {item.title ?? "Untitled"}
          </h4>
          {item.pubDate && (
            <span className="shrink-0 pt-0.5 text-xs tabular-nums text-neutral-400">
              {formatRelative(item.pubDate)}
            </span>
          )}
        </div>
        {summary && (
          <p className="mt-1 text-sm leading-relaxed text-neutral-600 line-clamp-3">
            {summary}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onDiscuss}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 hover:bg-blue-50 hover:text-blue-600"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Discuss
          </button>
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:text-blue-600"
            >
              Source
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7" />
                <path d="M7 7h10v10" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default DigestList;
