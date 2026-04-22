import type { DataFieldInfo } from "../api.ts";
import { recommendFor } from "./builtin/index.ts";

interface DataPanelProps {
  data: Record<string, DataFieldInfo>;
}

export function DataPanel({ data }: DataPanelProps) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-20 text-neutral-400">
        <DatabaseIcon className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm font-medium">No data fields found</p>
        <p className="mt-1 text-xs opacity-60">Define data in your frontmatter to see it here.</p>
      </div>
    );
  }

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
              <th className="px-4 py-3">Recommended</th>
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
                  <Recommendations resolved={field.resolved} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

function Recommendations({ resolved }: { resolved: DataFieldInfo["resolved"] }) {
  if (!resolved || resolved.kind !== "ready") return null;
  const names = recommendFor(resolved.value);
  if (names.length === 0) return <span className="text-neutral-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span
          key={name}
          className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 ring-1 ring-blue-100"
        >
          {name}
        </span>
      ))}
    </div>
  );
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}
