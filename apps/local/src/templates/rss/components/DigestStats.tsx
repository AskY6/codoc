import { formatRelative } from "./SourceBadge";

interface Item {
  source?: string;
}

interface DigestStatsProps {
  highlights?: Item[];
  trending?: Item[];
  lastDigestAt?: string;
}

export function DigestStats({ highlights = [], trending = [], lastDigestAt }: DigestStatsProps) {
  const sources = new Set(highlights.map((h) => h.source).filter(Boolean));
  return (
    <div className="not-prose mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-neutral-500">
      <span>
        <span className="font-semibold text-neutral-900">{highlights.length}</span> highlights
      </span>
      <span className="text-neutral-300">·</span>
      <span>
        <span className="font-semibold text-neutral-900">{sources.size}</span> sources
      </span>
      {trending.length > 0 && (
        <>
          <span className="text-neutral-300">·</span>
          <span>
            <span className="font-semibold text-neutral-900">{trending.length}</span> trending
          </span>
        </>
      )}
      {lastDigestAt && (
        <>
          <span className="text-neutral-300">·</span>
          <span>updated {formatRelative(lastDigestAt)}</span>
        </>
      )}
    </div>
  );
}

export default DigestStats;
