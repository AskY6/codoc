import type { ReactNode } from "react";
import type { AgentInfo, CodocListItem } from "@/types.js";

/**
 * Parse message text and render `@mentions` as styled inline spans.
 * Returns an array of string/ReactNode fragments suitable for React children.
 */
export function renderMentions(
  text: string,
  agents: AgentInfo[],
  codocs: CodocListItem[],
): ReactNode[] {
  // Build a map of @labels → kind for all known mentionables
  // Sort by label length descending so longer names match first
  const entries: Array<{ label: string; kind: "agent" | "codoc" }> = [
    ...agents.map((a) => ({ label: a.name, kind: "agent" as const })),
    ...codocs.map((c) => ({ label: c.path, kind: "codoc" as const })),
  ].sort((a, b) => b.label.length - a.label.length);

  if (entries.length === 0) {
    return [text];
  }

  // Build regex that matches @Label for any known entity
  const escaped = entries.map((e) =>
    e.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(`@(${escaped.join("|")})`, "g");

  const result: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    // Push text before the match
    if (start > lastIndex) {
      result.push(text.slice(lastIndex, start));
    }

    const label = match[1]!;
    result.push(
      <span
        key={key++}
        className="inline-flex items-center rounded-sm bg-primary/10 text-primary px-1 py-0.5 text-[0.85em] font-medium"
      >
        @{label}
      </span>,
    );

    lastIndex = start + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}
