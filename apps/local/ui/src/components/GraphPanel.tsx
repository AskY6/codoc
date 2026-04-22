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
const GAP_Y = 40;
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

  // 1. Build adjacency list and find root nodes
  // In our DAG, 'from' depends on 'to'. We want to show dependents on the left and dependencies on the right.
  const adj = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const codocPaths = codocs.map(c => c.path);
  
  codocPaths.forEach(p => {
    adj.set(p, []);
    incomingCount.set(p, 0);
  });

  const codocEdgeSet = new Set<string>();
  for (const edge of dag.edges ?? []) {
    const from = edge.from.split("#")[0]!;
    const to = edge.to.split("#")[0]!;
    if (from !== to && adj.has(from) && adj.has(to)) {
      if (!codocEdgeSet.has(`${from}|${to}`)) {
        codocEdgeSet.add(`${from}|${to}`);
        adj.get(from)!.push(to);
        incomingCount.set(to, (incomingCount.get(to) || 0) + 1);
      }
    }
  }

  // 2. Assign ranks (layers) using longest path
  const ranks = new Map<string, number>();
  codocPaths.forEach(p => ranks.set(p, 0));

  // Simple iterative rank assignment (handles cycles by limiting iterations)
  for (let i = 0; i < codocPaths.length; i++) {
    let changed = false;
    for (const [from, neighbors] of adj.entries()) {
      for (const to of neighbors) {
        if (ranks.get(to)! <= ranks.get(from)!) {
          ranks.set(to, ranks.get(from)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 3. Group nodes by rank and calculate positions
  const nodesByRank: Record<number, string[]> = {};
  let maxRank = 0;
  ranks.forEach((rank, path) => {
    nodesByRank[rank] = nodesByRank[rank] || [];
    nodesByRank[rank]!.push(path);
    if (rank > maxRank) maxRank = rank;
  });

  const nodes: CodocNode[] = [];
  const nodeMap = new Map<string, CodocNode>();

  const totalLayers = maxRank + 1;
  const layerWidths = Object.values(nodesByRank).map(group => group.length);
  const maxLayerHeight = Math.max(...layerWidths);

  Object.entries(nodesByRank).forEach(([rankStr, paths]) => {
    const rank = parseInt(rankStr);
    const layerHeight = paths.length;
    
    paths.forEach((path, i) => {
      const codoc = codocs.find(c => c.path === path)!;
      // Center the layer vertically relative to the tallest layer
      const verticalOffset = (maxLayerHeight - layerHeight) * (NODE_H + GAP_Y) / 2;
      
      const node: CodocNode = {
        path: codoc.path,
        title: codoc.title ?? codoc.path.replace(/\.codoc$/, ""),
        tags: codoc.tags,
        fieldCount: codoc.fields.length,
        x: MARGIN + rank * (NODE_W + GAP_X),
        y: MARGIN + verticalOffset + i * (NODE_H + GAP_Y),
      };
      nodes.push(node);
      nodeMap.set(path, node);
    });
  });

  // 4. Create edges for the layout
  const edges: CodocEdge[] = [];
  for (const key of codocEdgeSet) {
    const [fromPath, toPath] = key.split("|");
    const from = nodeMap.get(fromPath!);
    const to = nodeMap.get(toPath!);
    if (from && to) edges.push({ from, to });
  }

  const width = MARGIN * 2 + totalLayers * NODE_W + (totalLayers - 1) * GAP_X;
  const height = MARGIN * 2 + maxLayerHeight * NODE_H + (maxLayerHeight - 1) * GAP_Y;

  return { nodes, edges, width: Math.max(width, 800), height: Math.max(height, 500) };
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
          <p className="text-xs text-neutral-500">Dependent codocs on the left, dependencies on the right.</p>
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
                className="transition-all duration-300 hover:stroke-blue-400"
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
                fontSize={13}
                fontWeight={700}
                fill="#1f2937"
                className="transition-colors group-hover:fill-blue-600"
              >
                {node.title.length > 24 ? node.title.slice(0, 22) + "..." : node.title}
              </text>
              <text
                x={node.x + 16}
                y={node.y + 48}
                fontSize={10}
                fontWeight={500}
                fill="#9ca3af"
                className="uppercase tracking-wide"
              >
                {node.fieldCount} fields {node.tags.length > 0 ? `· ${node.tags[0]}` : ""}
              </text>
              
              <circle 
                cx={node.x + NODE_W - 20} 
                cy={node.y + 20} 
                r={3} 
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
