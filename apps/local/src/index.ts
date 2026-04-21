// codoc local — CLI entry point.
//
// Usage:
//   codoc                 — start server (HTTP + MCP + watch)
//   codoc init            — initialize knowledge base
//   codoc mcp [dir]       — start MCP server on stdio (for Claude Code)
//   codoc compile [dir]   — one-shot compile and exit
//   codoc dag [dir]       — print DAG relationships and exit
//
// dir defaults to current working directory.

import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { createSourceRegistry } from "@cobook/parser";
import { buildDAG, checkCycles, topoSort } from "@cobook/core";
import { loadWorkspace, compileAll, buildAstMap } from "./workspace.js";
import { startWatcher } from "./watcher.js";
import { startMcpServer, createMcpServer } from "./mcp-server.js";
import { startHttpServer } from "./http-server.js";
import { initWorkspace } from "./init.js";

const args = process.argv.slice(2);
const command = args[0] ?? "";
const explicitDir = command === "init" || command === "" ? args[1] : args[1];
const workspaceDir = resolve(explicitDir ?? process.cwd());
const sourceDir = join(workspaceDir, ".codoc");

// Read config.
interface Config {
  outDir?: string;
  port?: number;
}

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(join(workspaceDir, "codoc.config.json"), "utf-8")) as Config;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  // --- init: no workspace loading needed ---
  if (command === "init") {
    await initWorkspace(workspaceDir);
    return;
  }

  const cfg = readConfig();
  const outDir = cfg.outDir ? resolve(workspaceDir, cfg.outDir) : workspaceDir;
  const port = cfg.port ?? 4321;
  const sourceProviders = createSourceRegistry();

  // --- commands that need a loaded workspace ---
  const ws = await loadWorkspace(sourceDir, outDir, sourceProviders);

  switch (command) {
    case "mcp": {
      // Stdio MCP — Claude Code spawns this as a subprocess.
      startWatcher(ws);
      await startMcpServer(ws);
      break;
    }

    case "compile": {
      await compileAll(ws);
      console.log(`[codoc] compiled ${ws.codocs.size} file(s) → ${outDir}`);
      break;
    }

    case "dag": {
      printDAG(ws);
      break;
    }

    default: {
      // Unified mode: HTTP server + watch + MCP (StreamableHTTP).
      await compileAll(ws);
      console.log(`[codoc] ${ws.codocs.size} codoc(s) loaded`);

      const mcpServer = createMcpServer(ws);
      await startHttpServer({ port, mcpServer });
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
