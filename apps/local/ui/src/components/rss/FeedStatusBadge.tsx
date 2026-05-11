import type { RssFeedStatus } from "../../api.ts";

const config: Record<RssFeedStatus, { label: string; className: string; dot: string }> = {
  healthy: {
    label: "Healthy",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200/50",
    dot: "bg-emerald-500",
  },
  failing: {
    label: "Failing",
    className: "bg-red-50 text-red-700 ring-red-200/50",
    dot: "bg-red-500",
  },
  "never-fetched": {
    label: "Pending",
    className: "bg-neutral-50 text-neutral-500 ring-neutral-200/50",
    dot: "bg-neutral-400",
  },
};

interface FeedStatusBadgeProps {
  status: RssFeedStatus;
  lastError?: string | null;
}

export function FeedStatusBadge({ status, lastError }: FeedStatusBadgeProps) {
  const c = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${c.className}`}
      title={lastError ?? undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
