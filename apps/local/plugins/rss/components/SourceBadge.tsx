// Shared helpers for digest components — exported so sibling components import them.

interface SourceBadgeProps {
  source?: string;
  compact?: boolean;
}

const KNOWN: Record<string, string> = {
  "Hacker News": "bg-orange-100 text-orange-700",
  "Simon Willison": "bg-blue-100 text-blue-700",
  "GitHub Engineering": "bg-neutral-200 text-neutral-700",
};

const PALETTE = [
  "bg-emerald-100 text-emerald-700",
  "bg-purple-100 text-purple-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
];

function pickColor(source: string): string {
  if (KNOWN[source]) return KNOWN[source]!;
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

function initials(source: string): string {
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function SourceBadge({ source, compact }: SourceBadgeProps) {
  if (!source) return null;
  const cls = pickColor(source);
  if (compact) {
    return (
      <span
        title={source}
        className={`inline-flex h-5 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold tracking-tight ${cls}`}
      >
        {initials(source)}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {source}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Time formatter — relative for recent, absolute for old.
// ---------------------------------------------------------------------------

export function formatRelative(input?: string): string {
  if (!input) return "";
  const t = new Date(input).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "yesterday";
  if (diffD < 7) return `${diffD}d`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Summary cleaner — defensive, for digests written before extractSummary.
// ---------------------------------------------------------------------------

const NOISE_RE = /^(article url|comments url|points|# comments|comments)[\s:]/i;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi;
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
};

export function cleanSummary(raw?: string): string {
  if (!raw) return "";
  // Decode entities first so we can detect <p>/<a> tags after un-escaping.
  let text = raw.replace(HTML_ENTITY_RE, (_m, dec, hex, named) => {
    if (dec) return String.fromCharCode(Number(dec));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return ENTITIES[(named ?? "").toLowerCase()] ?? "";
  });
  text = text.replace(HTML_TAG_RE, " ").replace(/\s+/g, " ").trim();
  // Drop hnrss metadata lines.
  const parts = text.split(/(?=Article URL:|Comments URL:|Points:|# Comments:)/);
  const useful = parts.filter((p) => !NOISE_RE.test(p.trim()));
  return useful.join(" ").replace(/\s+/g, " ").trim();
}

export default SourceBadge;
