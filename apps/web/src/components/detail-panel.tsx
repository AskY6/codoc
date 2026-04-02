import { useState } from "react";
import { StatusPill } from "./status-pill.js";
import { ViewRenderer } from "./view-renderer.js";
import type { CodocDetail, GraphData, ViewNode } from "../types.js";

interface Props {
  codocDetail: CodocDetail | null;
  graph: GraphData | null;
  selectedPath: string | null;
}

type Tab = "view" | "data" | "graph";

/** Normalize resolvedData from full nodeId keys to simple field names,
 *  and unwrap {kind:"static", value:...} wrappers */
function normalizeResolvedData(
  resolvedData: Record<string, unknown> | null,
  codocPath: string,
): Record<string, unknown> | null {
  if (!resolvedData) return null;
  const result: Record<string, unknown> = {};
  const prefix = `${codocPath}#data.`;
  for (const [key, raw] of Object.entries(resolvedData)) {
    // Extract field name from nodeId like "notes/meeting.codoc#data.summary" → "summary"
    const fieldName = key.startsWith(prefix)
      ? key.slice(prefix.length)
      : key.replace(/^.*#data\./, "");
    // Unwrap {kind,value} wrappers
    let val = raw;
    while (val && typeof val === "object" && "kind" in val && "value" in val) {
      val = (val as { value: unknown }).value;
    }
    result[fieldName] = val;
  }
  return result;
}

function findUpstream(graph: GraphData, path: string): string[] {
  return graph.edges
    .filter((e) => e.from.startsWith(path))
    .map((e) => e.to.split("#")[0]!)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function findDownstream(graph: GraphData, path: string): string[] {
  return graph.edges
    .filter((e) => e.to.startsWith(path))
    .map((e) => e.from.split("#")[0]!)
    .filter((v, i, a) => a.indexOf(v) === i);
}

export function DetailPanel({ codocDetail, graph, selectedPath }: Props) {
  const [tab, setTab] = useState<Tab>("view");

  if (!selectedPath) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Select a codoc from the sidebar</p>
      </div>
    );
  }

  if (!codocDetail) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  const normalizedData = normalizeResolvedData(
    codocDetail.resolvedData,
    codocDetail.path,
  );

  const upstream = graph ? findUpstream(graph, selectedPath) : [];
  const downstream = graph ? findDownstream(graph, selectedPath) : [];

  const tabs: { key: Tab; label: string }[] = [
    { key: "view", label: "View" },
    { key: "data", label: "Data" },
    { key: "graph", label: "Dependencies" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{codocDetail.path}</h2>
          {codocDetail.ast?.meta?.title && (
            <p className="text-sm text-gray-500">{codocDetail.ast.meta.title}</p>
          )}
        </div>
        <StatusPill state={codocDetail.nodeState} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "view" && (
        <div>
          {codocDetail.ast?.view ? (
            <ViewRenderer
              node={codocDetail.ast.view as ViewNode}
              data={normalizedData}
            />
          ) : (
            <p className="text-sm text-gray-400 italic">No view defined for this codoc</p>
          )}
        </div>
      )}

      {tab === "data" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Resolved Data</h3>
            {codocDetail.resolvedData ? (
              <pre className="rounded-lg bg-gray-900 text-green-400 p-4 text-sm overflow-x-auto">
                {JSON.stringify(codocDetail.resolvedData, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 italic">No resolved data</p>
            )}
          </div>

          {codocDetail.ast?.data && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Data Definition (AST)</h3>
              <pre className="rounded-lg bg-gray-100 text-gray-800 p-4 text-sm overflow-x-auto">
                {JSON.stringify(codocDetail.ast.data, null, 2)}
              </pre>
            </div>
          )}

          {codocDetail.ast?.meta && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Meta</h3>
              <pre className="rounded-lg bg-gray-100 text-gray-800 p-4 text-sm overflow-x-auto">
                {JSON.stringify(codocDetail.ast.meta, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === "graph" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">
              Upstream (depends on)
            </h3>
            {upstream.length > 0 ? (
              <ul className="space-y-1">
                {upstream.map((p) => (
                  <li key={p} className="text-sm text-blue-600 flex items-center gap-1">
                    <span className="text-gray-400">&larr;</span> {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 italic">None</p>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">
              Downstream (depended by)
            </h3>
            {downstream.length > 0 ? (
              <ul className="space-y-1">
                {downstream.map((p) => (
                  <li key={p} className="text-sm text-orange-600 flex items-center gap-1">
                    <span className="text-gray-400">&rarr;</span> {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 italic">None</p>
            )}
          </div>

          {graph && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">All Edges</h3>
              <div className="rounded-lg bg-gray-100 p-3 text-xs space-y-1 max-h-60 overflow-y-auto">
                {graph.edges.length === 0 ? (
                  <p className="text-gray-400">No edges</p>
                ) : (
                  graph.edges.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-gray-600">
                      <span className="font-mono">{e.from}</span>
                      <span className="text-gray-400">&rarr;</span>
                      <span className="font-mono">{e.to}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
