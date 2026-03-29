"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { useWorkspaceDocs, useWorkspaceGraph } from "@/workspace/hooks/use-workspace";
import { cn } from "@/shared/utils";
import { Inbox } from "lucide-react";
import type { DocMeta, FieldAddress, DepEdge } from "@/shared/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DagGraphViewProps {
  references: string[];
  onAddReference: (docId: string) => void;
  onRemoveReference: (docId: string) => void;
}

// ---------------------------------------------------------------------------
// Layout constants (doc-level view)
// ---------------------------------------------------------------------------

const NODE_W = 180;
const NODE_H = 36;
const LAYER_GAP = 72;
const NODE_GAP_X = 32;
const PAD = 40;

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

interface LayoutNode {
  docId: string;
  label: string;
  fieldCount: number;
  x: number;
  y: number;
}

interface LayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ---------------------------------------------------------------------------
// DAG layout algorithm
// ---------------------------------------------------------------------------

function layoutDag(
  docs: DocMeta[],
  graph: { nodes: FieldAddress[]; edges: DepEdge[] },
): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  if (docs.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const docIds = docs.map((d) => d.docId);
  const docSet = new Set(docIds);
  const fieldsPerDoc = new Map(docs.map((d) => [d.docId, d.fields.length]));

  // Build doc-level adjacency.
  // Raw edge semantics: from.docId depends on to.docId.
  const upstream = new Map<string, Set<string>>();
  for (const id of docIds) upstream.set(id, new Set());

  const seenEdge = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from.docId === edge.to.docId) continue;
    if (!docSet.has(edge.from.docId) || !docSet.has(edge.to.docId)) continue;
    const key = `${edge.from.docId}\0${edge.to.docId}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    upstream.get(edge.from.docId)!.add(edge.to.docId);
  }

  // Layer assignment — longest path from roots (layer 0 = no upstream deps).
  const layers = new Map<string, number>();
  const visiting = new Set<string>();

  function dfs(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let max = -1;
    for (const up of upstream.get(id) ?? []) {
      max = Math.max(max, dfs(up));
    }
    const l = max + 1;
    layers.set(id, l);
    visiting.delete(id);
    return l;
  }
  for (const id of docIds) dfs(id);

  // Group by layer
  const groups = new Map<number, string[]>();
  for (const [id, l] of layers) {
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(id);
  }
  const maxLayer = Math.max(...layers.values(), 0);

  // Compute widest layer for centering
  let maxLayerW = 0;
  for (let l = 0; l <= maxLayer; l++) {
    const g = groups.get(l) ?? [];
    const w = g.length * NODE_W + Math.max(0, g.length - 1) * NODE_GAP_X;
    maxLayerW = Math.max(maxLayerW, w);
  }

  // Position nodes, centered per layer
  const nodeMap = new Map<string, LayoutNode>();
  for (let l = 0; l <= maxLayer; l++) {
    const g = groups.get(l) ?? [];
    const w = g.length * NODE_W + Math.max(0, g.length - 1) * NODE_GAP_X;
    const offset = (maxLayerW - w) / 2;
    g.forEach((id, i) => {
      nodeMap.set(id, {
        docId: id,
        label: id.replace(/\.codoc$/, ""),
        fieldCount: fieldsPerDoc.get(id) ?? 0,
        x: PAD + offset + i * (NODE_W + NODE_GAP_X),
        y: PAD + l * (NODE_H + LAYER_GAP),
      });
    });
  }

  // Build layout edges (data-flow direction: upstream → downstream)
  const layoutEdgeSet = new Set<string>();
  const layoutEdges: LayoutEdge[] = [];
  for (const [id, ups] of upstream) {
    for (const up of ups) {
      const key = `${up}\0${id}`;
      if (layoutEdgeSet.has(key)) continue;
      layoutEdgeSet.add(key);
      const fromNode = nodeMap.get(up)!;
      const toNode = nodeMap.get(id)!;
      layoutEdges.push({
        x1: fromNode.x + NODE_W / 2,
        y1: fromNode.y + NODE_H,
        x2: toNode.x + NODE_W / 2,
        y2: toNode.y,
      });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges: layoutEdges,
    width: maxLayerW + 2 * PAD,
    height: (maxLayer + 1) * (NODE_H + LAYER_GAP) - LAYER_GAP + 2 * PAD,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DagGraphView({
  references,
  onAddReference,
  onRemoveReference,
}: DagGraphViewProps) {
  const docs = useWorkspaceDocs();
  const graph = useWorkspaceGraph();
  const layout = useMemo(() => layoutDag(docs, graph), [docs, graph]);

  // Measure container to center the graph
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute viewBox to center the graph within the container
  const viewBox = useMemo(() => {
    const { w: cw, h: ch } = containerSize;
    const gw = layout.width;
    const gh = layout.height;
    if (cw === 0 || ch === 0) return `0 0 ${gw} ${gh}`;

    // If graph fits inside the container, center it; otherwise show full graph.
    const svgW = Math.max(gw, cw);
    const svgH = Math.max(gh, ch);
    const ox = (gw - svgW) / 2;
    const oy = (gh - svgH) / 2;
    return `${ox} ${oy} ${svgW} ${svgH}`;
  }, [containerSize, layout]);

  const [hovered, setHovered] = useState<string | null>(null);

  const handleNodeClick = useCallback(
    (docId: string) => {
      references.includes(docId)
        ? onRemoveReference(docId)
        : onAddReference(docId);
    },
    [references, onAddReference, onRemoveReference],
  );

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Inbox className="h-10 w-10 opacity-30" />
        <p className="text-sm">No codocs in workspace</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto bg-background">
      <svg
        width={Math.max(layout.width, containerSize.w)}
        height={Math.max(layout.height, containerSize.h)}
        viewBox={viewBox}
        className="select-none"
      >
        <defs>
          <marker
            id="dag-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" className="fill-muted-foreground/40" />
          </marker>
          <marker
            id="dag-arrow-hl"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" className="fill-foreground/60" />
          </marker>
        </defs>

        {/* Edges */}
        {layout.edges.map((e, i) => {
          const midY = (e.y1 + e.y2) / 2;
          // Highlight if either endpoint's doc is hovered
          const hl =
            hovered !== null &&
            layout.nodes.some(
              (n) =>
                n.docId === hovered &&
                ((n.x + NODE_W / 2 === e.x1 && n.y + NODE_H === e.y1) ||
                  (n.x + NODE_W / 2 === e.x2 && n.y === e.y2)),
            );
          return (
            <path
              key={i}
              d={`M${e.x1},${e.y1} C${e.x1},${midY} ${e.x2},${midY} ${e.x2},${e.y2}`}
              fill="none"
              className={cn(
                "transition-colors duration-150",
                hl ? "stroke-foreground/40" : "stroke-muted-foreground/20",
              )}
              strokeWidth={hl ? 2 : 1.5}
              markerEnd={hl ? "url(#dag-arrow-hl)" : "url(#dag-arrow)"}
            />
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((node) => {
          const isRef = references.includes(node.docId);
          const isHover = hovered === node.docId;
          return (
            <g
              key={node.docId}
              className="cursor-pointer"
              onClick={() => handleNodeClick(node.docId)}
              onMouseEnter={() => setHovered(node.docId)}
              onMouseLeave={() => setHovered(null)}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                className={cn(
                  "transition-colors duration-150",
                  isRef
                    ? "fill-accent stroke-foreground"
                    : isHover
                      ? "fill-muted stroke-foreground/50"
                      : "fill-card stroke-border",
                )}
                strokeWidth={isRef ? 1.5 : 1}
              />
              {/* Label */}
              <text
                x={node.x + 12}
                y={node.y + NODE_H / 2}
                dominantBaseline="central"
                className={cn(
                  "text-[12px] font-medium pointer-events-none",
                  isRef ? "fill-foreground" : "fill-foreground/80",
                )}
              >
                {node.label.length > 20
                  ? node.label.slice(0, 18) + "\u2026"
                  : node.label}
              </text>
              {/* Field count badge */}
              <text
                x={node.x + NODE_W - 12}
                y={node.y + NODE_H / 2}
                textAnchor="end"
                dominantBaseline="central"
                className="text-[10px] fill-muted-foreground pointer-events-none"
              >
                {node.fieldCount}f
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
