import { useMemo } from "react";
import type { DagStatus } from "../api.ts";

interface GraphPanelProps {
  dag: DagStatus | null;
  onSelectCodoc?: (path: string) => void;
}

// Layout constants
const NODE_W = 220;
const NODE_H = 64;
const GAP_X = 100;
const GAP_Y = 80;
const MARGIN = 60;

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
  const codocEdgeSet = new Set<string>();
  for (const edge of dag.edges ?? []) {
    const fromCodoc = edge.from.split("#")[0]!;
    const toCodoc = edge.to.split("#")[0]!;
    if (fromCodoc !== toCodoc) {
      codocEdgeSet.add(`${fromCodoc}|${toCodoc}`);
    }
  }

  // Layout: simple grid for now
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

  return { nodes, edges, width: Math.max(width, 600), height: Math.max(height, 400) };
}

export function GraphPanel({ dag, onSelectCodoc }: GraphPanelProps) {
  const layout = useMemo(
    () => dag ? computeLayout(dag) : null,
    [dag],
  );

  if (!dag) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-blue-600" />
      </div>
    );
  }

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-neutral-400">
        <GraphIcon className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm font-medium">Workspace graph is empty</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
        <div>
          <h3 className="text-lg font-bold text-neutral-800">Workspace Graph</h3>
          <p className="text-xs text-neutral-500">Visualizing relationships between codocs.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 ring-1 ring-blue-100">
            {layout.nodes.length} nodes
          </span>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-600 ring-1 ring-neutral-200">
            {layout.edges.length} edges
          </span>
          {(dag.cycles?.length ?? 0) > 0 && (
            <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 ring-1 ring-red-100 animate-pulse">
              {dag.cycles!.length} circular refs
            </span>
          )}
        </div>
      </div>

      {/* SVG canvas */}
      <div className="flex-1 overflow-auto bg-neutral-50/50 p-8">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="mx-auto select-none"
        >
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
              <feOffset dx="0" dy="2" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.1" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id="arrow"
              markerWidth="10"
              markerHeight="8"
              refX="10"
              refY="4"
              orient="auto"
            >
              <path d="M0 0 L10 4 L0 8 Z" fill="#94a3b8" />
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
                stroke="#cbd5e1"
                strokeWidth={2}
                markerEnd="url(#arrow)"
                className="transition-all duration-300"
              />
            );
          })}

          {/* Codoc nodes */}
          {layout.nodes.map((node) => (
            <g
              key={node.path}
              className={`group ${onSelectCodoc ? "cursor-pointer" : ""}`}
              onClick={() => onSelectCodoc?.(node.path)}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={12}
                fill="white"
                stroke="#e5e7eb"
                strokeWidth={1.5}
                filter="url(#shadow)"
                className="transition-all duration-200 group-hover:stroke-blue-400 group-hover:ring-4"
              />
              <text
                x={node.x + 16}
                y={node.y + 28}
                fontSize={14}
                fontWeight={700}
                fill="#1f2937"
                className="transition-colors group-hover:fill-blue-600"
              >
                {node.title.length > 24 ? node.title.slice(0, 22) + "..." : node.title}
              </text>
              <text
                x={node.x + 16}
                y={node.y + 48}
                fontSize={11}
                fontWeight={500}
                fill="#9ca3af"
                className="uppercase tracking-wide"
              >
                {node.fieldCount} fields {node.tags.length > 0 ? `· ${node.tags[0]}` : ""}
              </text>
              
              {/* Highlight circle on hover */}
              <circle 
                cx={node.x + NODE_W - 20} 
                cy={node.y + 20} 
                r={4} 
                className="fill-neutral-200 group-hover:fill-blue-500 transition-colors"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
