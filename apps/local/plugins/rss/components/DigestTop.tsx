import { SourceBadge, formatRelative, cleanSummary } from "./SourceBadge";

interface Item {
  title?: string;
  source?: string;
  link?: string;
  summary?: string;
  pubDate?: string;
}

interface DigestTopProps {
  items?: Item[];
  count?: number;
}

export function DigestTop({ items = [], count = 3 }: DigestTopProps) {
  const top = items.slice(0, count);
  if (top.length === 0) return null;

  return (
    <div className="not-prose mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
      {top.map((item, i) => (
        <HeroCard key={i} item={item} lead={i === 0} />
      ))}
    </div>
  );
}

function HeroCard({ item, lead }: { item: Item; lead: boolean }) {
  const cleaned = cleanSummary(item.summary);
  const summary = cleaned && cleaned !== item.title ? cleaned : "";
  return (
    <div
      className={`group flex flex-col rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 hover:shadow-sm ${
        lead ? "md:col-span-3 md:p-5" : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] text-neutral-500">
        <SourceBadge source={item.source} />
        {item.pubDate && <span>{formatRelative(item.pubDate)}</span>}
      </div>
      <h3
        className={`mb-2 font-semibold leading-snug text-neutral-900 ${
          lead ? "text-xl line-clamp-2" : "text-base line-clamp-2"
        }`}
      >
        {item.title ?? "Untitled"}
      </h3>
      {summary && (
        <p
          className={`mb-3 text-sm leading-relaxed text-neutral-700 ${
            lead ? "line-clamp-4" : "line-clamp-4"
          }`}
        >
          {summary}
        </p>
      )}
      <CardActions item={item} className="mt-auto pt-1" />
    </div>
  );
}

function CardActions({ item, className }: { item: Item; className?: string }) {
  const onDiscuss = () => {
    const w = (typeof window !== "undefined" ? window : ({} as Window)) as Window & {
      codoc?: { discuss(a: Item): Promise<void> };
    };
    void w.codoc?.discuss(item);
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={onDiscuss}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:border-blue-500 hover:text-blue-600"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Discuss
      </button>
      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 transition hover:text-blue-600"
          title="Read original"
        >
          Source
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>
      )}
    </div>
  );
}

export default DigestTop;
