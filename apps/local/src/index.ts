// codoc — CLI entry point.
//
// Usage:
//   codoc start [workspace]  — start server (HTTP + MCP + watch)
//   codoc init <workspace>   — initialize a new workspace
//   codoc add <component|--all> [workspace] — add component to workspace
//   codoc mcp <workspace>    — start MCP server on stdio
//   codoc compile <workspace> — one-shot compile and exit
//   codoc dag <workspace>    — print DAG relationships and exit
//
// Workspaces live under ~/.codoc/<name>/

import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createSourceRegistry } from "@cobook/parser";
import { buildDAG, checkCycles, topoSort } from "@cobook/core";
import { loadWorkspace, compileAll, buildAstMap } from "./workspace.js";
import type { Workspace } from "./workspace.js";
import { startWatcher } from "./watcher.js";
import { startMcpServer } from "./mcp-server.js";
import { startHttpServer } from "./http-server.js";
import { initWorkspace } from "./init.js";
import { addComponent } from "./add.js";

const CODOC_HOME = join(homedir(), ".codoc");

const args = process.argv.slice(2);
const command = args[0] ?? "";
const workspaceName = args[1];

function resolveWorkspaceDir(name: string): string {
  return join(CODOC_HOME, name);
}

// Read config from workspace directory.
interface Config {
  outDir?: string;
  port?: number;
}

function readConfig(workspaceDir: string): Config {
  try {
    return JSON.parse(
      readFileSync(join(workspaceDir, "codoc.config.json"), "utf-8"),
    ) as Config;
  } catch {
    return {};
  }
}

/** Load a workspace by name, resolving paths under ~/.codoc/<name>. */
async function openWorkspace(name: string) {
  const workspaceDir = resolveWorkspaceDir(name);
  const cfg = readConfig(workspaceDir);
  const outDir = cfg.outDir ? resolve(workspaceDir, cfg.outDir) : workspaceDir;
  const port = cfg.port ?? 4321;
  const sourceProviders = createSourceRegistry();
  const ws = await loadWorkspace(workspaceDir, outDir, sourceProviders);
  return { ws, workspaceDir, outDir, port };
}

async function main(): Promise<void> {
  switch (command) {
    case "init": {
      if (!workspaceName) {
        console.error("Usage: codoc init <workspace>");
        process.exit(1);
      }
      await initWorkspace(resolveWorkspaceDir(workspaceName));
      break;
    }

    case "add": {
      const componentArg = args[1];
      if (!componentArg) {
        console.error("Usage: codoc add <component|--all|--list> [workspace]");
        process.exit(1);
      }
      if (componentArg === "--list") {
        await addComponent("--list", "");
        break;
      }
      const wsArg = args[2];
      if (!wsArg) {
        console.error("Usage: codoc add <component|--all> <workspace>");
        process.exit(1);
      }
      const targetDir = join(resolveWorkspaceDir(wsArg), "components");
      await addComponent(componentArg, targetDir);
      break;
    }

    case "start": {
      if (!workspaceName) {
        // No workspace specified — start server with workspace picker UI.
        const cfg = readConfig(CODOC_HOME); // global config fallback
        const port = cfg.port ?? 4321;
        await startHttpServer({ port });
        break;
      }

      const { ws, port } = await openWorkspace(workspaceName);
      await compileAll(ws);
      console.log(`[codoc] ${ws.codocs.size} codoc(s) loaded from ${workspaceName}`);
      await startHttpServer({ port, initialWorkspace: { name: workspaceName, workspace: ws } });
      break;
    }

    case "mcp": {
      if (!workspaceName) {
        console.error("Usage: codoc mcp <workspace>");
        process.exit(1);
      }
      const { ws } = await openWorkspace(workspaceName);
      startWatcher(ws);
      await startMcpServer(ws);
      break;
    }

    case "compile": {
      if (!workspaceName) {
        console.error("Usage: codoc compile <workspace>");
        process.exit(1);
      }
      const { ws, outDir } = await openWorkspace(workspaceName);
      await compileAll(ws);
      console.log(`[codoc] compiled ${ws.codocs.size} file(s) → ${outDir}`);
      break;
    }

    case "dag": {
      if (!workspaceName) {
        console.error("Usage: codoc dag <workspace>");
        process.exit(1);
      }
      const { ws } = await openWorkspace(workspaceName);
      printDAG(ws);
      break;
    }

    default: {
      console.log("Usage: codoc <command> [workspace]\n");
      console.log("Commands:");
      console.log("  start [workspace]          Start server");
      console.log("  init <workspace>           Initialize a new workspace");
      console.log("  add <component> <workspace>  Add a component (or --all)");
      console.log("  mcp <workspace>            Start MCP server on stdio");
      console.log("  compile <workspace>        One-shot compile");
      console.log("  dag <workspace>            Print DAG relationships");
      console.log(`\nWorkspaces: ${CODOC_HOME}`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listWorkspaces(): Promise<string[]> {
  try {
    const entries = await readdir(CODOC_HOME, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

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
