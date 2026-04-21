// codoc local — CLI entry point.
//
// Usage:
//   codoc watch [sourceDir]   — watch + compile (default mode)
//   codoc mcp [sourceDir]     — start MCP server on stdio
//   codoc compile [sourceDir] — one-shot compile and exit
//   codoc dag [sourceDir]     — print DAG relationships and exit
//
// sourceDir defaults to current working directory.
// Output goes to .preview/ relative to sourceDir.

import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { createSourceRegistry } from "@cobook/service";
import { buildDAG, checkCycles, topoSort } from "@cobook/core";
import { loadWorkspace, compileAll, buildAstMap } from "./workspace.js";
import { startWatcher } from "./watcher.js";
import { startMcpServer } from "./mcp-server.js";

const args = process.argv.slice(2);
const command = args[0] ?? "watch";
const workspaceDir = resolve(args[1] ?? process.cwd());
const sourceDir = join(workspaceDir, ".codoc");

// Read outDir from codoc.config.json if present, else default to workspaceDir.
let outDir = workspaceDir;
try {
  const cfg = JSON.parse(readFileSync(join(workspaceDir, "codoc.config.json"), "utf-8"));
  if (cfg.outDir) outDir = resolve(workspaceDir, cfg.outDir);
} catch {
  // No config file — use default.
}

async function main(): Promise<void> {
  const sourceProviders = createSourceRegistry();
  const ws = await loadWorkspace(sourceDir, outDir, sourceProviders);

  switch (command) {
    case "mcp": {
      // MCP mode: start stdio server for Claude Code integration.
      // Also start watcher in background to keep compiled output fresh.
      startWatcher(ws);
      await startMcpServer(ws);
      break;
    }

    case "compile": {
      // One-shot: compile all and exit.
      await compileAll(ws);
      console.log(`[codoc] compiled ${ws.codocs.size} file(s) → ${outDir}`);
      break;
    }

    case "dag": {
      printDAG(ws);
      break;
    }

    case "watch":
    default: {
      // Watch mode: compile on change, log to console.
      await compileAll(ws);
      console.log(`[codoc] watching .codoc/ → ${outDir}`);
      console.log(`[codoc] ${ws.codocs.size} codoc(s) loaded`);
      startWatcher(ws);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// DAG command
// ---------------------------------------------------------------------------

import type { Workspace } from "./workspace.js";

function printDAG(ws: Workspace): void {
  const astMap = buildAstMap(ws);
  const dagResult = buildDAG(astMap);

  if (!dagResult.ok) {
    console.error("[codoc] DAG build errors (unresolved refs):");
    for (const e of dagResult.error) {
      console.error(`  ${e.source} → ${e.target} (unknown)`);
    }
    process.exit(1);
  }

  const dag = dagResult.value;

  if (dag.nodes.size === 0) {
    console.log("[codoc] no data fields — DAG is empty");
    return;
  }

  // Edges
  console.log(`# DAG: ${dag.nodes.size} node(s), ${dag.edges.length} edge(s)\n`);

  if (dag.edges.length > 0) {
    console.log("## Edges\n");
    for (const edge of dag.edges) {
      console.log(`  ${edge.from} → ${edge.to}`);
    }
    console.log();
  }

  // Cycles
  const cycleCheck = checkCycles(dag);
  if (cycleCheck.kind === "cyclic") {
    console.log("## Cycles (ERROR)\n");
    for (const cycle of cycleCheck.cycles) {
      console.log(`  ${cycle.path.join(" → ")}`);
    }
    console.log();
  }

  // Topo order
  const topo = topoSort(dag);
  console.log("## Topological order\n");
  if (topo.kind === "sorted") {
    for (const id of topo.order) {
      console.log(`  ${id}`);
    }
  } else {
    console.log("  (partial — blocked by cycles)");
    for (const id of topo.sortedPrefix) {
      console.log(`  ${id}`);
    }
    if (topo.remaining.length > 0) {
      console.log("  --- blocked ---");
      for (const id of topo.remaining) {
        console.log(`  ${id}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
