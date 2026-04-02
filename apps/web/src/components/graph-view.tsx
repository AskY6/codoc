import { useMemo } from "react";
import type { GraphData } from "@/types.js";

interface Props {
  graph: GraphData;
}

interface LayoutNode {
  path: string;
  state: string;
  x: number;
  y: number;
}

const NODE_W = 140;
const NODE_H = 32;
const GAP_X = 40;
const GAP_Y = 50;
const PAD = 20;

function layout(graph: GraphData): { nodes: LayoutNode[]; width: number; height: number } {
  // Topological layering via longest-path
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();

  for (const n of graph.nodes) {
    adj.set(n.path, []);
    inDeg.set(n.path, 0);
  }
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  // Assign layers via BFS from roots
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [p, deg] of inDeg) {
    if (deg === 0) {
      queue.push(p);
      layer.set(p, 0);
    }
  }

  let maxLayer = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const cl = layer.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      const nl = Math.max(layer.get(next) ?? 0, cl + 1);
      layer.set(next, nl);
      maxLayer = Math.max(maxLayer, nl);
      if (!queue.includes(next)) queue.push(next);
    }
  }

  // Assign unvisited nodes to layer 0
  for (const n of graph.nodes) {
    if (!layer.has(n.path)) layer.set(n.path, 0);
  }

  // Group by layer
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of graph.nodes) {
    layers[layer.get(n.path)!]!.push(n.path);
  }

  const maxPerLayer = Math.max(...layers.map((l) => l.length), 1);
  const width = (maxLayer + 1) * (NODE_W + GAP_X) - GAP_X + PAD * 2;
  const height = maxPerLayer * (NODE_H + GAP_Y) - GAP_Y + PAD * 2;

  const stateMap = new Map(graph.nodes.map((n) => [n.path, n.nodeState]));

  const nodes: LayoutNode[] = [];
  for (let li = 0; li <= maxLayer; li++) {
    const col = layers[li]!;
    const totalH = col.length * (NODE_H + GAP_Y) - GAP_Y;
    const offsetY = (height - totalH) / 2;
    for (let ri = 0; ri < col.length; ri++) {
      nodes.push({
        path: col[ri]!,
        state: stateMap.get(col[ri]!) ?? "idle",
        x: PAD + li * (NODE_W + GAP_X),
        y: offsetY + ri * (NODE_H + GAP_Y),
      });
    }
  }

  return { nodes, width, height };
}

const STATE_COLORS: Record<string, string> = {
  ready: "#22c55e",
  idle: "#94a3b8",
  dirty: "#f59e0b",
  error: "#ef4444",
  computing: "#3b82f6",
};

export function GraphView({ graph }: Props) {
  const { nodes, width, height } = useMemo(() => layout(graph), [graph]);
  const posMap = new Map(nodes.map((n) => [n.path, n]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ minHeight: 200, maxHeight: 400 }}
    >
      {/* Edges */}
      {graph.edges.map((e) => {
        const from = posMap.get(e.from);
        const to = posMap.get(e.to);
        if (!from || !to) return null;
        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x;
        const y2 = to.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        );
      })}
      {/* Arrow marker */}
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX={10}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-border)" />
        </marker>
      </defs>
      {/* Nodes */}
      {nodes.map((n) => (
        <g key={n.path}>
          <rect
            x={n.x}
            y={n.y}
            width={NODE_W}
            height={NODE_H}
            rx={6}
            fill="var(--color-card)"
            stroke={STATE_COLORS[n.state] ?? STATE_COLORS.idle}
            strokeWidth={2}
          />
          <text
            x={n.x + NODE_W / 2}
            y={n.y + NODE_H / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="text-[10px] fill-foreground"
          >
            {n.path.length > 18 ? `...${n.path.slice(-15)}` : n.path}
          </text>
        </g>
      ))}
    </svg>
  );
}
