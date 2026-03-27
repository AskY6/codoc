import { useCallback, useSyncExternalStore, useMemo } from "react";
import { extractExternalDeps, type DataTree, type FieldState } from "@codoc/core";
import type { CodocRuntime } from "./runtime.js";

// --- Field status hook ---

const IDLE_STATE: FieldState<unknown> = { status: "idle" };

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

// --- Graph data types ---

interface NodeInfo {
  id: string; // "docId:fieldPath"
  docId: string;
  fieldPath: string;
}

interface EdgeInfo {
  from: string; // source node id
  to: string; // target node id
  cross: boolean; // cross-document edge?
}

interface DocGroup {
  docId: string;
  nodes: NodeInfo[];
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Layout constants ---

const NODE_W = 150;
const NODE_H = 28;
const NODE_GAP = 6;
const DOC_PAD = 14;
const DOC_HEADER = 28;
const DOC_GAP = 100;
const MARGIN = 16;

// --- SVG Node with reactive status ---

function DAGNode({
  node,
  x,
  y,
  tree,
}: {
  node: NodeInfo;
  x: number;
  y: number;
  tree: DataTree;
}) {
  const status = useFieldStatus(tree, node.fieldPath);

  const fills: Record<string, string> = {
    resolved: "#d4edda",
    dirty: "#fff3cd",
    error: "#f8d7da",
    pending: "#e2e3e5",
    idle: "#e2e3e5",
  };

  const strokes: Record<string, string> = {
    resolved: "#82c091",
    dirty: "#e0a800",
    error: "#d9534f",
    pending: "#adb5bd",
    idle: "#adb5bd",
  };

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={4}
        fill={fills[status] ?? fills.idle}
        stroke={strokes[status] ?? strokes.idle}
        strokeWidth={1.5}
        style={{ transition: "fill 0.4s, stroke 0.3s" }}
      />
      <text
        x={x + NODE_W / 2}
        y={y + NODE_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontFamily="'SF Mono', Monaco, monospace"
        fill="#333"
      >
        {node.fieldPath}
      </text>
    </g>
  );
}

// --- Edge rendering ---

function DAGEdge({
  x1,
  y1,
  x2,
  y2,
  cross,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cross: boolean;
}) {
  // Curved path for cross-doc edges, straight for intra-doc
  if (cross) {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <path
        d={d}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        markerEnd="url(#arrow-cross)"
        style={{ transition: "stroke 0.3s" }}
      />
    );
  }
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#999"
      strokeWidth={1}
      markerEnd="url(#arrow-intra)"
    />
  );
}

// --- Main component ---

export function UnifiedDAG({
  runtimes,
}: {
  runtimes: Map<string, CodocRuntime>;
}) {
  const { docGroups, allNodes, edges, svgWidth, svgHeight } = useMemo(() => {
    const allNodes = new Map<string, NodeInfo>();
    const edges: EdgeInfo[] = [];
    const docGroups: DocGroup[] = [];

    let currentX = MARGIN;

    // Build nodes and layout per document
    for (const [docId, rt] of runtimes) {
      const fieldPaths = rt.dag.getNodes().sort();
      const nodes: NodeInfo[] = fieldPaths.map((fp) => {
        const info: NodeInfo = { id: `${docId}:${fp}`, docId, fieldPath: fp };
        allNodes.set(info.id, info);
        return info;
      });

      const groupWidth = NODE_W + DOC_PAD * 2;
      const groupHeight = DOC_HEADER + nodes.length * (NODE_H + NODE_GAP) + DOC_PAD;

      docGroups.push({
        docId,
        nodes,
        x: currentX,
        y: MARGIN,
        width: groupWidth,
        height: groupHeight,
      });

      // Intra-doc edges
      for (const node of fieldPaths) {
        for (const dep of rt.dag.getDirectDeps(node)) {
          edges.push({
            from: `${docId}:${dep}`,
            to: `${docId}:${node}`,
            cross: false,
          });
        }
      }

      currentX += groupWidth + DOC_GAP;
    }

    // Cross-doc edges
    for (const [docId, rt] of runtimes) {
      for (const dep of extractExternalDeps(rt.tree)) {
        edges.push({
          from: `${dep.docRef}:${dep.fieldPath}`,
          to: `${docId}:${dep.localPath}`,
          cross: true,
        });
      }
    }

    const maxHeight = Math.max(...docGroups.map((g) => g.height));
    return {
      docGroups,
      allNodes,
      edges,
      svgWidth: currentX - DOC_GAP + MARGIN,
      svgHeight: maxHeight + MARGIN * 2,
    };
  }, [runtimes]);

  // Compute node positions by (docGroup, index within group)
  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    for (const group of docGroups) {
      for (let i = 0; i < group.nodes.length; i++) {
        const node = group.nodes[i];
        pos.set(node.id, {
          x: group.x + DOC_PAD,
          y: group.y + DOC_HEADER + i * (NODE_H + NODE_GAP),
        });
      }
    }
    return pos;
  }, [docGroups]);

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="w-full"
      style={{ maxWidth: svgWidth }}
    >
      <defs>
        <marker
          id="arrow-cross"
          markerWidth={8}
          markerHeight={6}
          refX={8}
          refY={3}
          orient="auto"
        >
          <path d="M 0 0 L 8 3 L 0 6 Z" fill="#3b82f6" />
        </marker>
        <marker
          id="arrow-intra"
          markerWidth={6}
          markerHeight={5}
          refX={6}
          refY={2.5}
          orient="auto"
        >
          <path d="M 0 0 L 6 2.5 L 0 5 Z" fill="#999" />
        </marker>
      </defs>

      {/* Document group backgrounds */}
      {docGroups.map((group) => (
        <g key={group.docId}>
          <rect
            x={group.x}
            y={group.y}
            width={group.width}
            height={group.height}
            rx={8}
            fill="none"
            stroke="#d0d0d0"
            strokeWidth={1}
            strokeDasharray="6 3"
          />
          <text
            x={group.x + DOC_PAD}
            y={group.y + 18}
            fontSize={11}
            fontWeight={600}
            fill="#666"
          >
            {group.docId}
          </text>
        </g>
      ))}

      {/* Edges (render before nodes so they appear behind) */}
      {edges.map(({ from, to, cross }) => {
        const fromPos = nodePositions.get(from);
        const toPos = nodePositions.get(to);
        if (!fromPos || !toPos) return null;

        // Connect right side of source → left side of target for cross-doc
        // For intra-doc, connect bottom of source → top of target
        let x1: number, y1: number, x2: number, y2: number;
        if (cross) {
          x1 = fromPos.x + NODE_W;
          y1 = fromPos.y + NODE_H / 2;
          x2 = toPos.x;
          y2 = toPos.y + NODE_H / 2;
        } else {
          x1 = fromPos.x + NODE_W / 2;
          y1 = fromPos.y + NODE_H;
          x2 = toPos.x + NODE_W / 2;
          y2 = toPos.y;
        }
        return (
          <DAGEdge
            key={`${from}->${to}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            cross={cross}
          />
        );
      })}

      {/* Field nodes */}
      {docGroups.map((group) => {
        const rt = runtimes.get(group.docId);
        if (!rt) return null;
        return group.nodes.map((node) => {
          const pos = nodePositions.get(node.id)!;
          return (
            <DAGNode
              key={node.id}
              node={node}
              x={pos.x}
              y={pos.y}
              tree={rt.tree}
            />
          );
        });
      })}
    </svg>
  );
}
