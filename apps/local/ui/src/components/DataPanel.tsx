import { useState, useEffect } from "react";
import type { DataFieldInfo, Enhancement } from "../api.ts";
import { api } from "../api.ts";

interface DataPanelProps {
  data: Record<string, DataFieldInfo>;
  codocPath: string;
  content: string;
  onApply: (newContent: string) => void;
}

export function DataPanel({ data, codocPath, content, onApply }: DataPanelProps) {
  const entries = Object.entries(data);
  const [enhancements, setEnhancements] = useState<Enhancement[]>([]);

  useEffect(() => {
    let stale = false;
    api.enhancements(codocPath).then((result) => {
      if (!stale) setEnhancements(result);
    }).catch(() => {});
    return () => { stale = true; };
  }, [codocPath, content]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-20 text-neutral-400">
        <DatabaseIcon className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm font-medium">No data fields found</p>
        <p className="mt-1 text-xs opacity-60">Define data in your frontmatter to see it here.</p>
      </div>
    );
  }

  const enhancementMap = new Map(enhancements.map((e) => [e.field, e]));

  const handleApply = (fieldName: string, template: string) => {
    const enhancement = enhancementMap.get(fieldName);
    if (!enhancement) return;

    const newContent =
      enhancement.currentUsage === "raw-expression"
        ? replaceRawExpression(content, fieldName, template)
        : appendToBody(content, template);

    onApply(newContent);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-neutral-800">Resolved Data</h3>
        <p className="text-sm text-neutral-500">Live values resolved from static fields, refs, and sources.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/50 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Resolved Value</th>
              <th className="px-4 py-3">Enhance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entries.map(([name, field]) => (
              <tr key={name} className="group transition-colors hover:bg-neutral-50/30">
                <td className="px-4 py-4">
                  <span className="font-mono font-bold text-blue-600">{name}</span>
                </td>
                <td className="px-4 py-4">
                  <KindBadge kind={field.kind} />
                </td>
                <td className="px-4 py-4">
                  <StatusBadge resolved={field.resolved} />
                </td>
                <td className="max-w-xs px-4 py-4">
                  <div className="truncate font-mono text-xs text-neutral-600">
                    <ResolvedValue resolved={field.resolved} />
                  </div>
                </td>
                <td className="px-4 py-4">
                  <EnhanceSuggestions
                    enhancement={enhancementMap.get(name)}
                    onApply={(template) => handleApply(name, template)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enhancement suggestions
// ---------------------------------------------------------------------------

function EnhanceSuggestions({
  enhancement,
  onApply,
}: {
  enhancement: Enhancement | undefined;
  onApply: (template: string) => void;
}) {
  // No enhancement data → field already uses a component or no match
  if (!enhancement) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-green-500">
        <CheckIcon />
        in use
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {enhancement.suggestions.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => onApply(s.template)}
          className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100 transition-all hover:bg-blue-100 hover:ring-blue-300 cursor-pointer"
          title={`Apply: ${s.template}`}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apply helpers
// ---------------------------------------------------------------------------

/** Replace `{data.fieldName}` (and surrounding text line) with the template. */
function replaceRawExpression(content: string, fieldName: string, template: string): string {
  // Replace the raw expression `{data.fieldName}` with the component template
  const pattern = new RegExp(`\\{data\\.${escapeRegExp(fieldName)}\\}`, "g");
  return content.replace(pattern, template);
}

/** Append template to the end of the MDX body. */
function appendToBody(content: string, template: string): string {
  return content.trimEnd() + "\n\n" + template + "\n";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Sub-components (unchanged)
// ---------------------------------------------------------------------------

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    static: "bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200",
    ref: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    source: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${colors[kind] ?? "bg-neutral-100"}`}>
      {kind}
    </span>
  );
}

function StatusBadge({ resolved }: { resolved: DataFieldInfo["resolved"] }) {
  if (!resolved) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-neutral-400">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-300" />
        pending
      </span>
    );
  }
  if (resolved.kind === "ready") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
        <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
        ready
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-red-600">
      <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
      error
    </span>
  );
}

function ResolvedValue({ resolved }: { resolved: DataFieldInfo["resolved"] }) {
  if (!resolved) return <span className="text-neutral-300">-</span>;
  if (resolved.kind === "error") {
    return (
      <span className="text-red-500 italic">{resolved.error?.message ?? "unknown error"}</span>
    );
  }
  const val = resolved.value;
  if (val === null || val === undefined) return <span className="opacity-40">null</span>;
  if (typeof val === "object") return <span>{JSON.stringify(val)}</span>;
  return <span className="text-neutral-800">{String(val)}</span>;
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
