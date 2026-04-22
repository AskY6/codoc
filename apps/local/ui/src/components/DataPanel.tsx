import type { DataFieldInfo } from "../api.ts";

interface DataPanelProps {
  data: Record<string, DataFieldInfo>;
}

export function DataPanel({ data }: DataPanelProps) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        No data fields
      </div>
    );
  }

  return (
    <div className="overflow-auto p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="pb-2 pr-4 font-medium">Field</th>
            <th className="pb-2 pr-4 font-medium">Kind</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, field]) => (
            <tr key={name} className="border-b border-neutral-100">
              <td className="py-2 pr-4 font-mono text-blue-700">{name}</td>
              <td className="py-2 pr-4">
                <KindBadge kind={field.kind} />
              </td>
              <td className="py-2 pr-4">
                <StatusBadge resolved={field.resolved} />
              </td>
              <td className="py-2 font-mono text-xs">
                <ResolvedValue resolved={field.resolved} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    static: "bg-neutral-100 text-neutral-600",
    ref: "bg-purple-100 text-purple-700",
    source: "bg-teal-100 text-teal-700",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${colors[kind] ?? "bg-neutral-100"}`}>
      {kind}
    </span>
  );
}

function StatusBadge({ resolved }: { resolved: DataFieldInfo["resolved"] }) {
  if (!resolved) {
    return <span className="text-xs text-neutral-400">pending</span>;
  }
  if (resolved.kind === "ready") {
    return <span className="text-xs text-green-600">ready</span>;
  }
  return <span className="text-xs text-red-600">error</span>;
}

function ResolvedValue({ resolved }: { resolved: DataFieldInfo["resolved"] }) {
  if (!resolved) return <span className="text-neutral-300">-</span>;
  if (resolved.kind === "error") {
    return (
      <span className="text-red-600">{resolved.error?.message ?? "unknown error"}</span>
    );
  }
  const val = resolved.value;
  if (val === null || val === undefined) return <span className="text-neutral-400">null</span>;
  if (typeof val === "object") return <>{JSON.stringify(val)}</>;
  return <>{String(val)}</>;
}
