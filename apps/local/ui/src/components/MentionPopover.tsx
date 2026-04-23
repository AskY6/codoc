import { useEffect, useRef, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionItem {
  /** Codoc path — used as the @label inserted into the textarea */
  path: string;
  /** Human-readable name shown in the popover */
  displayName: string;
  /** Secondary line (e.g. path when displayName is title) */
  secondary?: string | undefined;
}

// ---------------------------------------------------------------------------
// useMentionItems — filter codocs by query
// ---------------------------------------------------------------------------

export function useMentionItems(
  codocs: ReadonlyArray<{ path: string; title: string | null }>,
  query: string,
): MentionItem[] {
  return useMemo(() => {
    const q = query.toLowerCase();
    return codocs
      .filter(
        (c) =>
          c.path.toLowerCase().includes(q) ||
          (c.title ?? "").toLowerCase().includes(q),
      )
      .map((c) => ({
        path: c.path,
        displayName: c.title ?? c.path,
        secondary: c.title ? c.path : undefined,
      }));
  }, [codocs, query]);
}

// ---------------------------------------------------------------------------
// parseMentionedCodocs — extract @mentions from message text
// ---------------------------------------------------------------------------

export function parseMentionedCodocs(
  text: string,
  codocs: ReadonlyArray<{ path: string }>,
): string[] {
  // Sort by path length descending so longer paths match first
  const sorted = [...codocs].sort((a, b) => b.path.length - a.path.length);
  const mentioned: string[] = [];
  for (const codoc of sorted) {
    if (text.includes(`@${codoc.path}`)) {
      mentioned.push(codoc.path);
    }
  }
  return mentioned;
}

// ---------------------------------------------------------------------------
// renderMentions — render @mentions as styled inline spans
// ---------------------------------------------------------------------------

export function renderMentions(
  text: string,
  codocs: ReadonlyArray<{ path: string }>,
): React.ReactNode[] {
  const sorted = [...codocs].sort((a, b) => b.path.length - a.path.length);
  if (sorted.length === 0) return [text];

  const escaped = sorted.map((c) =>
    c.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(`@(${escaped.join("|")})`, "g");

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > lastIndex) {
      result.push(text.slice(lastIndex, start));
    }
    result.push(
      <span
        key={key++}
        className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[0.85em] font-medium text-blue-600"
      >
        <MentionFileIcon />@{match[1]}
      </span>,
    );
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

// ---------------------------------------------------------------------------
// MentionPopover
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  items: MentionItem[];
  activeIndex: number;
  onSelect: (item: MentionItem) => void;
}

export function MentionPopover({ open, items, activeIndex, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!open || items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        Codocs
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto">
        {items.map((item, i) => (
          <button
            key={item.path}
            data-active={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault(); // keep textarea focus
              onSelect(item);
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              i === activeIndex
                ? "bg-blue-50 text-blue-700"
                : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <FileIcon />
            <div className="flex-1 min-w-0">
              <div className="truncate">{item.displayName}</div>
              {item.secondary && (
                <div className="text-xs text-neutral-400 truncate">
                  {item.secondary}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-neutral-400"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MentionFileIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
