import { useRef, useEffect, useCallback, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { DagStatus } from "../api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphPanelProps {
  dag: DagStatus | null;
  onSelectCodoc?: (path: string) => void;
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  tags: string[];
  fieldCount: number;
  edgeCount: number;
}

interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: GraphNode;
  target: GraphNode;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const BG = "#191919";
const EDGE_COLOR = "rgba(0, 210, 211, 0.15)";
const EDGE_HOVER_COLOR = "rgba(0, 210, 211, 0.6)";
const LABEL_COLOR = "#ccc";
const LABEL_HOVER_COLOR = "#fff";

const TAG_COLORS: Record<string, string> = {
  _default: "#e439dc",   // magenta/pink
  source: "#39e460",     // green
  data: "#39e460",
  api: "#39b8e4",        // blue
  config: "#e4a839",     // orange
};

function nodeColor(node: GraphNode): string {
  for (const tag of node.tags) {
    const c = TAG_COLORS[tag.toLowerCase()];
    if (c) return c;
  }
  return TAG_COLORS._default!;
}

function nodeRadius(node: GraphNode): number {
  return Math.max(4, Math.min(20, 4 + node.edgeCount * 2.5));
}

// ---------------------------------------------------------------------------
// Camera (pan + zoom)
// ---------------------------------------------------------------------------

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function screenToWorld(sx: number, sy: number, cam: Camera): [number, number] {
  return [(sx - cam.x) / cam.zoom, (sy - cam.y) / cam.zoom];
}

// ---------------------------------------------------------------------------
// Build graph data from DAG
// ---------------------------------------------------------------------------

function buildGraph(dag: DagStatus): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const codocs = dag.codocs ?? [];
  if (codocs.length === 0) return { nodes: [], edges: [] };

  // Deduplicate edges at codoc level
  const edgeSet = new Set<string>();
  const edgePairs: [string, string][] = [];
  for (const edge of dag.edges ?? []) {
    const from = edge.from.split("#")[0]!;
    const to = edge.to.split("#")[0]!;
    if (from !== to) {
      const key = `${from}|${to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgePairs.push([from, to]);
      }
    }
  }

  // Count edges per node
  const edgeCounts = new Map<string, number>();
  for (const [from, to] of edgePairs) {
    edgeCounts.set(from, (edgeCounts.get(from) ?? 0) + 1);
    edgeCounts.set(to, (edgeCounts.get(to) ?? 0) + 1);
  }

  const nodeMap = new Map<string, GraphNode>();
  const nodes: GraphNode[] = codocs.map((c) => {
    const node: GraphNode = {
      id: c.path,
      label: c.title ?? c.path.replace(/\.codoc$/, ""),
      tags: c.tags,
      fieldCount: c.fields.length,
      edgeCount: edgeCounts.get(c.path) ?? 0,
    };
    nodeMap.set(c.path, node);
    return node;
  });

  const edges: GraphEdge[] = [];
  for (const [from, to] of edgePairs) {
    const s = nodeMap.get(from);
    const t = nodeMap.get(to);
    if (s && t) edges.push({ source: s, target: t });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Fingerprint — cheap content hash to avoid restarting the simulation
// when the polled DAG data hasn't actually changed.
// ---------------------------------------------------------------------------

function dagFingerprint(dag: DagStatus): string {
  const codocs = (dag.codocs ?? []).map((c) => c.path).sort().join(",");
  const edges = (dag.edges ?? []).map((e) => `${e.from}>${e.to}`).sort().join(",");
  return `${codocs}|${edges}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphPanel({ dag, onSelectCodoc }: GraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mutable refs for render loop state (avoids re-renders)
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoveredRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<{ node: GraphNode; offsetX: number; offsetY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
  const animRef = useRef<number>(0);
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const needsDrawRef = useRef(true);
  const dagFingerprintRef = useRef<string>("");
  const [initialized, setInitialized] = useState(false);

  // --- Build simulation when dag changes ---
  useEffect(() => {
    if (!dag) return;

    // Fingerprint: skip rebuild if data hasn't actually changed
    const fp = dagFingerprint(dag);
    if (fp === dagFingerprintRef.current) return;
    dagFingerprintRef.current = fp;

    const { nodes, edges } = buildGraph(dag);
    if (nodes.length === 0) {
      nodesRef.current = [];
      edgesRef.current = [];
      needsDrawRef.current = true;
      return;
    }

    nodesRef.current = nodes;
    edgesRef.current = edges;

    // Stop previous simulation
    simRef.current?.stop();

    const sim = forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance(120)
          .strength(0.4),
      )
      .force("charge", forceManyBody<GraphNode>().strength(-300).distanceMax(500))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GraphNode>((d) => nodeRadius(d) + 8))
      .alphaDecay(0.02)
      .on("tick", () => {
        needsDrawRef.current = true;
      })
      .on("end", () => {
        needsDrawRef.current = true;
      });

    simRef.current = sim;
    setInitialized(true);

    // Center camera on first load
    const canvas = canvasRef.current;
    if (canvas) {
      camRef.current = { x: canvas.width / (2 * devicePixelRatio), y: canvas.height / (2 * devicePixelRatio), zoom: 1 };
    }

    return () => {
      sim.stop();
    };
  }, [dag]);

  // --- Canvas sizing ---
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = devicePixelRatio;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // Re-center camera
    camRef.current.x = rect.width / 2;
    camRef.current.y = rect.height / 2;
    needsDrawRef.current = true;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // --- Draw loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!needsDrawRef.current) return;
      needsDrawRef.current = false;

      const dpr = devicePixelRatio;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cam = camRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const hovered = hoveredRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      // Edges
      for (const edge of edges) {
        const s = edge.source;
        const t = edge.target;
        if (s.x == null || s.y == null || t.x == null || t.y == null) continue;

        const isHighlighted = hovered && (s.id === hovered.id || t.id === hovered.id);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isHighlighted ? EDGE_HOVER_COLOR : EDGE_COLOR;
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.stroke();
      }

      // Nodes
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const r = nodeRadius(node);
        const isHovered = hovered?.id === node.id;
        const color = nodeColor(node);

        // Glow
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(")", ", 0.25)").replace("rgb", "rgba");
          ctx.fill();
        }

        // Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        const fontSize = Math.max(10, Math.min(13, 9 + r * 0.3));
        ctx.font = `${isHovered ? "600" : "400"} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = isHovered ? LABEL_HOVER_COLOR : LABEL_COLOR;
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, node.x + r + 6, node.y);
      }

      ctx.restore();
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [initialized]);

  // --- Hit test ---
  const hitTest = useCallback((mx: number, my: number): GraphNode | null => {
    const [wx, wy] = screenToWorld(mx, my, camRef.current);
    const nodes = nodesRef.current;
    // Reverse iterate so topmost node is hit first
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n) + 4; // tolerance
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, []);

  // --- Pointer events ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const node = hitTest(mx, my);
      if (node) {
        // Start dragging node
        const [wx, wy] = screenToWorld(mx, my, camRef.current);
        dragRef.current = { node, offsetX: wx - (node.x ?? 0), offsetY: wy - (node.y ?? 0) };
        node.fx = node.x;
        node.fy = node.y;
        simRef.current?.alphaTarget(0.3).restart();
        canvas.setPointerCapture(e.pointerId);
      } else {
        // Start panning
        panRef.current = { startX: mx, startY: my, camX: camRef.current.x, camY: camRef.current.y };
        canvas.setPointerCapture(e.pointerId);
      }
    },
    [hitTest],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (dragRef.current) {
        const [wx, wy] = screenToWorld(mx, my, camRef.current);
        const d = dragRef.current;
        d.node.fx = wx - d.offsetX;
        d.node.fy = wy - d.offsetY;
        needsDrawRef.current = true;
      } else if (panRef.current) {
        const p = panRef.current;
        camRef.current.x = p.camX + (mx - p.startX);
        camRef.current.y = p.camY + (my - p.startY);
        needsDrawRef.current = true;
      } else {
        // Hover detection
        const node = hitTest(mx, my);
        if (node !== hoveredRef.current) {
          hoveredRef.current = node;
          canvas.style.cursor = node ? "pointer" : "grab";
          needsDrawRef.current = true;
        }
      }
    },
    [hitTest],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (dragRef.current) {
        const d = dragRef.current;
        // If barely moved, treat as click
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const [wx, wy] = screenToWorld(mx, my, camRef.current);
        const dx = wx - (d.node.x ?? 0);
        const dy = wy - (d.node.y ?? 0);
        const movedDist = Math.sqrt(dx * dx + dy * dy);
        if (movedDist < 3) {
          onSelectCodoc?.(d.node.id);
        }
        d.node.fx = null;
        d.node.fy = null;
        simRef.current?.alphaTarget(0);
        dragRef.current = null;
      }
      panRef.current = null;
      canvas.releasePointerCapture(e.pointerId);
    },
    [onSelectCodoc],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const cam = camRef.current;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.1, Math.min(5, cam.zoom * factor));

    // Zoom toward cursor position
    cam.x = mx - ((mx - cam.x) / cam.zoom) * newZoom;
    cam.y = my - ((my - cam.y) / cam.zoom) * newZoom;
    cam.zoom = newZoom;
    needsDrawRef.current = true;
  }, []);

  // --- Loading state ---
  if (!dag) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: BG }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-cyan-400" />
      </div>
    );
  }

  if ((dag.codocs ?? []).length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center" style={{ background: BG }}>
        <GraphIcon className="mb-4 h-12 w-12 opacity-20 text-neutral-600" />
        <p className="text-sm font-medium text-neutral-500">Workspace graph is empty</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ cursor: "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Stats overlay */}
      <div className="absolute left-4 top-4 flex items-center gap-2 pointer-events-none select-none">
        <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400 ring-1 ring-white/10 backdrop-blur-sm">
          {nodesRef.current.length} nodes
        </span>
        <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 ring-1 ring-white/10 backdrop-blur-sm">
          {edgesRef.current.length} edges
        </span>
        {(dag.cycles?.length ?? 0) > 0 && (
          <span className="rounded-full bg-red-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-red-400 ring-1 ring-red-500/20 backdrop-blur-sm animate-pulse">
            {dag.cycles!.length} circular refs
          </span>
        )}
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 right-4 pointer-events-none select-none">
        <span className="rounded-lg bg-white/5 px-3 py-1.5 text-[10px] text-neutral-500 ring-1 ring-white/10 backdrop-blur-sm">
          Scroll to zoom &middot; Drag to pan &middot; Click node to open
        </span>
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
