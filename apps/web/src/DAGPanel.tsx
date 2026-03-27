import { useCallback, useSyncExternalStore } from "react";
import {
  topoLayers,
  buildDocDAG,
  extractExternalDeps,
  type DataTree,
  type FieldState,
  type DocRegistry,
} from "@codoc/core";
import type { CodocRuntime } from "./runtime.js";

const IDLE_STATE: FieldState<unknown> = { status: "idle" };

const STATUS_COLORS: Record<string, string> = {
  resolved: "#d4edda",
  dirty: "#fff3cd",
  error: "#f8d7da",
  pending: "#e2e3e5",
  idle: "#e2e3e5",
};

function useFieldStatus(tree: DataTree, path: string): string {
  const subscribe = useCallback(
    (cb: () => void) => tree.subscribeField(path, cb),
    [tree, path],
  );
  const getSnapshot = useCallback(
    () => tree.getField(path)?.state ?? IDLE_STATE,
    [tree, path],
  );
  return useSyncExternalStore(subscribe, getSnapshot).status;
}

function FieldNode({ tree, path }: { tree: DataTree; path: string }) {
  const status = useFieldStatus(tree, path);
  return (
    <span
      className="dag-node"
      style={{ background: STATUS_COLORS[status] }}
      title={status}
    >
      {path}
    </span>
  );
}

function IntraDocDAG({
  docId,
  runtime,
}: {
  docId: string;
  runtime: CodocRuntime;
}) {
  const { dag, tree } = runtime;
  const layers = topoLayers(dag);
  const nodes = dag.getNodes();

  if (nodes.length === 0) {
    return <div className="dag-empty">No fields</div>;
  }

  // Collect edges for rendering arrows
  const edges: { from: string; to: string }[] = [];
  for (const node of nodes) {
    for (const dep of dag.getDirectDeps(node)) {
      edges.push({ from: dep, to: node });
    }
  }

  return (
    <div className="dag-section">
      <div className="dag-title">{docId} — Field DAG</div>
      <div className="dag-layers">
        {layers.map((layer, i) => (
          <div key={i} className="dag-layer">
            <span className="dag-layer-label">L{i}</span>
            {layer.map((path) => (
              <FieldNode key={path} tree={tree} path={path} />
            ))}
          </div>
        ))}
      </div>
      {edges.length > 0 && (
        <div className="dag-edges">
          {edges.map(({ from, to }) => (
            <div key={`${from}->${to}`} className="dag-edge">
              <code>{from}</code>
              <span className="dag-arrow">&rarr;</span>
              <code>{to}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CrossDocDAG({
  registry,
  runtimes,
}: {
  registry: DocRegistry;
  runtimes: Map<string, CodocRuntime>;
}) {
  const { nodes, edges } = buildDocDAG(registry);

  // Collect field-level detail per edge
  const edgeDetails = new Map<string, string[]>();
  for (const [docId, rt] of runtimes) {
    const extDeps = extractExternalDeps(rt.tree);
    for (const dep of extDeps) {
      const key = `${docId}->${dep.docRef}`;
      let list = edgeDetails.get(key);
      if (!list) {
        list = [];
        edgeDetails.set(key, list);
      }
      list.push(`${dep.localPath} ← ${dep.fieldPath}`);
    }
  }

  return (
    <div className="dag-section">
      <div className="dag-title">Cross-Doc DAG</div>
      {nodes.length === 0 ? (
        <div className="dag-empty">No documents</div>
      ) : (
        <>
          <div className="dag-doc-nodes">
            {nodes.map((n) => (
              <span key={n} className="dag-doc-node">{n}</span>
            ))}
          </div>
          {edges.map(({ from, to }) => {
            const details = edgeDetails.get(`${from}->${to}`) ?? [];
            return (
              <div key={`${from}->${to}`} className="dag-cross-edge">
                <div className="dag-edge">
                  <code>{to}</code>
                  <span className="dag-arrow">&rarr;</span>
                  <code>{from}</code>
                </div>
                {details.length > 0 && (
                  <div className="dag-edge-details">
                    {details.map((d) => (
                      <div key={d} className="dag-edge-detail">{d}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export function DAGPanel({
  selectedDocId,
  runtimes,
  registry,
}: {
  selectedDocId: string;
  runtimes: Map<string, CodocRuntime>;
  registry: DocRegistry;
}) {
  const selectedRuntime = runtimes.get(selectedDocId);

  return (
    <div className="dag-panel">
      {selectedRuntime && (
        <IntraDocDAG docId={selectedDocId} runtime={selectedRuntime} />
      )}
      <CrossDocDAG registry={registry} runtimes={runtimes} />
    </div>
  );
}
