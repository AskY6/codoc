import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { resolveWorkspaceId } from "../workspace-discovery.js";

export function registerGraphCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("graph")
    .description("Show the dependency graph")
    .argument("[path]", "Optional codoc path to show only its upstream/downstream")
    .action(async (path: string | undefined) => {
      const client = getClient();
      const wsId = await resolveWorkspaceId(
        client,
        program.opts()["workspace"] as string | undefined,
      );

      const graph = await client.getGraph(wsId);

      if (graph.edges.length === 0) {
        console.log("No edges in the dependency graph.");
        if (graph.nodes.length > 0) {
          console.log(`Nodes: ${graph.nodes.map((n) => n.path).join(", ")}`);
        }
        return;
      }

      if (path) {
        // Filter to edges involving this codoc
        const relevant = graph.edges.filter(
          (e) => e.from.startsWith(path) || e.to.startsWith(path),
        );
        if (relevant.length === 0) {
          console.log(`No dependencies found for ${path}`);
          return;
        }
        console.log(`Dependencies for ${path}:\n`);
        for (const e of relevant) {
          console.log(`  ${e.from} → ${e.to}`);
        }
        return;
      }

      // Full graph
      console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);

      // Group by source codoc
      const bySource = new Map<string, string[]>();
      for (const e of graph.edges) {
        const src = e.from.split("#")[0] ?? e.from;
        const list = bySource.get(src) ?? [];
        list.push(`${e.from} → ${e.to}`);
        bySource.set(src, list);
      }

      for (const [src, edges] of bySource) {
        console.log(`  ${src}`);
        for (const edge of edges) {
          console.log(`    ${edge}`);
        }
      }
    });
}
