import { useMemo } from "react";
import type { DagStatus } from "../api.ts";

interface GraphPanelProps {
  dag: DagStatus | null;
  onSelectCodoc?: (path: string) => void;
}

// Layout constants
const NODE_W = 200;
const NODE_H = 48;
const GAP_X = 80;
const GAP_Y = 60;
const MARGIN = 40;

interface CodocNode {
  path: string;
  title: string;
  tags: string[];
  fieldCount: number;
  x: number;
  y: number;
}

interface CodocEdge {
  from: CodocNode;
  to: CodocNode;
}

interface Layout {
  nodes: CodocNode[];
  edges: CodocEdge[];
  width: number;
  height: number;
}

function computeLayout(dag: DagStatus): Layout {
  const codocs = dag.codocs ?? [];
  if (codocs.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // Build codoc-level edges from field-level edges
  // Field edge: "a.codoc#data.x" → "b.codoc#data.y" means codoc a depends on codoc b
  const codocEdgeSet = new Set<string>();
  for (const edge of dag.edges ?? []) {
    const fromCodoc = edge.from.split("#")[0]!;
    const toCodoc = edge.to.split("#")[0]!;
    if (fromCodoc !== toCodoc) {
      codocEdgeSet.add(`${fromCodoc}|${toCodoc}`);
    }
  }

  // Layout: arrange in a grid, 3 columns
  const COLS = 3;
  const nodes: CodocNode[] = codocs.map((c, i) => ({
    path: c.path,
    title: c.title ?? c.path.replace(/\.codoc$/, ""),
    tags: c.tags,
    fieldCount: c.fields.length,
    x: MARGIN + (i % COLS) * (NODE_W + GAP_X),
    y: MARGIN + Math.floor(i / COLS) * (NODE_H + GAP_Y),
  }));

  const nodeMap = new Map(nodes.map((n) => [n.path, n]));

  const edges: CodocEdge[] = [];
  for (const key of codocEdgeSet) {
    const [fromPath, toPath] = key.split("|");
    const from = nodeMap.get(fromPath!);
    const to = nodeMap.get(toPath!);
    if (from && to) edges.push({ from, to });
  }

  const maxCol = Math.min(codocs.length, COLS);
  const rows = Math.ceil(codocs.length / COLS);
  const width = MARGIN * 2 + maxCol * NODE_W + (maxCol - 1) * GAP_X;
  const height = MARGIN * 2 + rows * NODE_H + (rows - 1) * GAP_Y;

  return { nodes, edges, width: Math.max(width, 400), height: Math.max(height, 200) };
}

export function GraphPanel({ dag, onSelectCodoc }: GraphPanelProps) {
  const layout = useMemo(
    () => dag ? computeLayout(dag) : null,
    [dag],
  );

  if (!dag) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        Loading graph...
      </div>
    );
  }

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        No codocs in workspace
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <span className="text-sm font-medium">Workspace Graph</span>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>{layout.nodes.length} codoc(s)</span>
          <span>{layout.edges.length} relation(s)</span>
          {(dag.cycles?.length ?? 0) > 0 && (
            <span className="rounded bg-red-50 px-2 py-0.5 text-red-600">
              {dag.cycles!.length} cycle(s)
            </span>
          )}
        </div>
      </div>

      {/* SVG canvas */}
      <div className="flex-1 overflow-auto bg-neutral-50 p-4">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="select-none"
        >
          <defs>
            <marker
              id="arrow"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Edges */}
          {layout.edges.map((edge, i) => {
            const fx = edge.from.x + NODE_W;
            const fy = edge.from.y + NODE_H / 2;
            const tx = edge.to.x;
            const ty = edge.to.y + NODE_H / 2;
            const mx = (fx + tx) / 2;

            return (
              <path
                key={i}
                d={`M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Codoc nodes */}
          {layout.nodes.map((node) => (
            <g
              key={node.path}
              className={onSelectCodoc ? "cursor-pointer" : undefined}
              onClick={() => onSelectCodoc?.(node.path)}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="white"
                stroke="#d4d4d8"
                strokeWidth={1}
              />
              <text
                x={node.x + 12}
                y={node.y + 20}
                fontSize={13}
                fontWeight={600}
                fill="#18181b"
              >
                {node.title.length > 22 ? node.title.slice(0, 20) + "..." : node.title}
              </text>
              <text
                x={node.x + 12}
                y={node.y + 36}
                fontSize={11}
                fill="#a1a1aa"
              >
                {node.fieldCount} field(s)
                {node.tags.length > 0 ? ` · ${node.tags.join(", ")}` : ""}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
