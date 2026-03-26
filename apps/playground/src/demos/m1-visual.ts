import { DataTree, DAG, topoLayers, propagateDirty } from "@codoc/core";
import { header } from "../helpers.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

interface VisNode {
  id: string;
  deps: string[];
  dependents: string[];
  layer: number;
  indexInLayer: number;
  layerSize: number;
}

function buildVisData(dag: DAG): VisNode[] {
  const layers = topoLayers(dag);
  const nodes: VisNode[] = [];

  for (let layer = 0; layer < layers.length; layer++) {
    const layerNodes = layers[layer];
    for (let i = 0; i < layerNodes.length; i++) {
      const id = layerNodes[i];
      nodes.push({
        id,
        deps: dag.getDirectDeps(id),
        dependents: dag.getDependents(id),
        layer,
        indexInLayer: i,
        layerSize: layerNodes.length,
      });
    }
  }

  return nodes;
}

function generateHTML(nodes: VisNode[], totalLayers: number): string {
  const nodesJSON = JSON.stringify(nodes);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CoDoc M1 — DAG Visualizer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; }
  .container { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
  .panel { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .panel-title { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  svg { width: 100%; display: block; }
  .node-rect { cursor: pointer; transition: fill 0.3s, stroke 0.3s; rx: 8; ry: 8; }
  .node-rect.idle { fill: #334155; stroke: #475569; }
  .node-rect.resolved { fill: #164e63; stroke: #22d3ee; }
  .node-rect.dirty { fill: #7f1d1d; stroke: #f87171; }
  .node-rect:hover { filter: brightness(1.3); }
  .node-label { font-family: ui-monospace, monospace; font-size: 13px; fill: #e2e8f0; pointer-events: none; text-anchor: middle; dominant-baseline: central; }
  .edge { stroke: #475569; stroke-width: 1.5; fill: none; marker-end: url(#arrow); transition: stroke 0.3s; }
  .edge.dirty { stroke: #f87171; stroke-width: 2; }
  .legend { display: flex; gap: 16px; margin-bottom: 16px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #94a3b8; }
  .legend-swatch { width: 14px; height: 14px; border-radius: 4px; }
  .log { font-family: ui-monospace, monospace; font-size: 13px; background: #0f172a; border-radius: 8px; padding: 12px; max-height: 200px; overflow-y: auto; line-height: 1.6; }
  .log-entry { color: #94a3b8; }
  .log-entry .path { color: #22d3ee; }
  .log-entry .action { color: #f87171; }
  .log-entry .resolve { color: #4ade80; }
  .btn { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; transition: background 0.2s; }
  .btn:hover { background: #475569; }
  .controls { display: flex; gap: 8px; margin-bottom: 12px; }
  .topo-layers { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .topo-layer { background: #0f172a; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-family: ui-monospace, monospace; }
  .topo-layer .label { color: #64748b; }
</style>
</head>
<body>
<div class="container">
  <h1>CoDoc M1 — DAG Visualizer</h1>
  <p class="subtitle">Click any node to simulate a value change and watch dirty propagation</p>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background:#334155;border:1px solid #475569"></div> Idle</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#164e63;border:1px solid #22d3ee"></div> Resolved</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#7f1d1d;border:1px solid #f87171"></div> Dirty</div>
  </div>

  <div class="panel">
    <div class="panel-title">Dependency Graph</div>
    <svg id="dag-svg"></svg>
  </div>

  <div class="panel">
    <div class="panel-title">Topological Layers</div>
    <div id="topo-layers" class="topo-layers"></div>
  </div>

  <div class="panel">
    <div class="controls">
      <div class="panel-title" style="flex:1;margin:0;line-height:28px">Propagation Log</div>
      <button class="btn" onclick="resetAll()">Reset All</button>
      <button class="btn" onclick="resolveAll()">Resolve All</button>
    </div>
    <div id="log" class="log"><div class="log-entry">Ready. Click a node to begin.</div></div>
  </div>
</div>

<script>
const nodes = ${nodesJSON};
const totalLayers = ${totalLayers};

// Build lookup maps
const nodeMap = new Map();
nodes.forEach(n => nodeMap.set(n.id, n));

// State: 'idle' | 'resolved' | 'dirty'
const state = new Map();
nodes.forEach(n => state.set(n.id, 'idle'));

// Layout constants
const NODE_W = 130, NODE_H = 40, LAYER_GAP = 80, PAD = 40;
const svgEl = document.getElementById('dag-svg');

function nodeX(n) {
  const totalW = n.layerSize * NODE_W + (n.layerSize - 1) * 30;
  const startX = (svgWidth() - totalW) / 2;
  return startX + n.indexInLayer * (NODE_W + 30) + NODE_W / 2;
}
function nodeY(n) { return PAD + n.layer * (NODE_H + LAYER_GAP) + NODE_H / 2; }
function svgWidth() { const maxInLayer = Math.max(...nodes.map(n => n.layerSize)); return Math.max(400, maxInLayer * (NODE_W + 30) + PAD * 2); }
function svgHeight() { return totalLayers * (NODE_H + LAYER_GAP) + PAD; }

function render() {
  const w = svgWidth(), h = svgHeight();
  svgEl.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

  let html = '<defs><marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 3.5 L 0 7 z" fill="#475569"/></marker>';
  html += '<marker id="arrow-dirty" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 3.5 L 0 7 z" fill="#f87171"/></marker></defs>';

  // Edges
  nodes.forEach(n => {
    n.deps.forEach(depId => {
      const dep = nodeMap.get(depId);
      if (!dep) return;
      const x1 = nodeX(dep), y1 = nodeY(dep) + NODE_H / 2;
      const x2 = nodeX(n), y2 = nodeY(n) - NODE_H / 2;
      const isDirty = state.get(n.id) === 'dirty';
      const marker = isDirty ? 'url(#arrow-dirty)' : 'url(#arrow)';
      const midY = (y1 + y2) / 2;
      html += '<path class="edge' + (isDirty ? ' dirty' : '') + '" d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2 + '" marker-end="' + marker + '"/>';
    });
  });

  // Nodes
  nodes.forEach(n => {
    const x = nodeX(n), y = nodeY(n);
    const s = state.get(n.id);
    html += '<rect class="node-rect ' + s + '" x="' + (x - NODE_W/2) + '" y="' + (y - NODE_H/2) + '" width="' + NODE_W + '" height="' + NODE_H + '" stroke-width="2" onclick="onClickNode(\\'' + n.id + '\\')"/>';
    html += '<text class="node-label" x="' + x + '" y="' + y + '">' + n.id + '</text>';
  });

  svgEl.innerHTML = html;
}

function renderLayers() {
  const layers = [];
  nodes.forEach(n => { if (!layers[n.layer]) layers[n.layer] = []; layers[n.layer].push(n.id); });
  const el = document.getElementById('topo-layers');
  el.innerHTML = layers.map((l, i) => '<div class="topo-layer"><span class="label">L' + i + ':</span> ' + l.join(', ') + '</div>').join('');
}

function log(msg) {
  const el = document.getElementById('log');
  el.innerHTML += '<div class="log-entry">' + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}

function onClickNode(id) {
  // If not resolved, resolve it first
  if (state.get(id) !== 'resolved') {
    resolveWithDeps(id);
    return;
  }

  // Simulate value change → dirty propagation
  log('<span class="action">Changed</span> <span class="path">' + id + '</span> → propagating dirty...');

  const dirty = computeDirty(id);
  if (dirty.length === 0) {
    log('  No downstream dependents to dirty.');
  }

  let delay = 0;
  dirty.forEach(d => {
    setTimeout(() => {
      state.set(d, 'dirty');
      log('  <span class="action">Dirty</span> → <span class="path">' + d + '</span>');
      render();
    }, delay);
    delay += 300;
  });

  setTimeout(() => {
    log('  Propagation complete. ' + dirty.length + ' field(s) dirtied.');
  }, delay);
}

function resolveWithDeps(id) {
  const node = nodeMap.get(id);
  const toResolve = [];

  // Resolve deps first (BFS upward)
  function collectDeps(nid) {
    const n = nodeMap.get(nid);
    if (!n) return;
    n.deps.forEach(d => { if (state.get(d) !== 'resolved') collectDeps(d); });
    if (!toResolve.includes(nid)) toResolve.push(nid);
  }
  collectDeps(id);

  let delay = 0;
  toResolve.forEach(rid => {
    setTimeout(() => {
      state.set(rid, 'resolved');
      log('<span class="resolve">Resolved</span> <span class="path">' + rid + '</span>');
      render();
    }, delay);
    delay += 200;
  });
}

function computeDirty(changedId) {
  const dirty = [];
  const visited = new Set();
  const queue = [changedId];
  visited.add(changedId);

  while (queue.length > 0) {
    const cur = queue.shift();
    const n = nodeMap.get(cur);
    if (!n) continue;
    n.dependents.forEach(d => {
      if (!visited.has(d)) {
        visited.add(d);
        dirty.push(d);
        queue.push(d);
      }
    });
  }
  return dirty;
}

function resetAll() {
  nodes.forEach(n => state.set(n.id, 'idle'));
  render();
  log('<span class="action">Reset</span> all fields to idle.');
}

function resolveAll() {
  nodes.forEach(n => state.set(n.id, 'resolved'));
  render();
  log('<span class="resolve">Resolved</span> all fields.');
}

render();
renderLayers();
</script>
</body>
</html>`;
}

export async function run() {
  header("M1 · Interactive DAG Visualizer (browser)");

  const tree = new DataTree({
    type: {
      properties: {
        price: { type: "number" },
        quantity: { type: "number" },
        subtotal: { type: "number" },
        tax_rate: { type: "number" },
        tax: { type: "number" },
        total: { type: "number" },
        label: { type: "string" },
      },
    },
    data: {
      price: 100,
      quantity: 3,
      subtotal: { $ref: "/price" },
      tax_rate: 0.1,
      tax: { $ref: "/subtotal" },
      total: { $ref: "/tax" },
      label: "Order Summary",
    },
  });

  const dag = DAG.buildFromTree(tree);
  const layers = topoLayers(dag);
  const visNodes = buildVisData(dag);

  const html = generateHTML(visNodes, layers.length);
  // Navigate from this file to monorepo root: demos/ → src/ → playground/ → apps/ → root
  const outDir = resolve(import.meta.dirname, "..", "..", "..", "..", ".output");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "codoc-m1-dag.html");
  writeFileSync(outFile, html);

  console.log(`\n  Generated: ${outFile}`);
  console.log("  Opening in browser...\n");
  console.log("  Instructions:");
  console.log("    1. Click a node to resolve it (and its deps)");
  console.log("    2. Click a resolved node to simulate a change → dirty propagation");
  console.log('    3. Use "Resolve All" then click any node to see propagation\n');

  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execSync(`${cmd} "${outFile}"`);
  } catch {
    console.log(`  Could not auto-open. Open manually: ${outFile}`);
  }
}
