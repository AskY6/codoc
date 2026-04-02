import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { requireWorkspaceId } from "../require-workspace.js";

export function registerStatusCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("status")
    .description("Show workspace codoc status overview")
    .action(async () => {
      const client = getClient();
      const wsId = requireWorkspaceId(program);

      const [status, codocs] = await Promise.all([
        client.getWorkspaceStatus(wsId),
        client.listCodocs(wsId),
      ]);

      if (codocs.length === 0) {
        console.log("No codocs found in this workspace.");
        return;
      }

      // Table
      const header = `${"PATH".padEnd(40)} ${"STATE".padEnd(10)}`;
      console.log(header);
      console.log("-".repeat(header.length));
      for (const c of codocs) {
        const stateStr = colorState(c.nodeState);
        console.log(`${c.path.padEnd(40)} ${stateStr}`);
      }

      // Summary
      console.log();
      const parts = Object.entries(status.states)
        .map(([k, v]) => `${k}: ${v}`)
        .join("  ");
      console.log(`Total: ${status.codocCount}  ${parts}`);
    });
}

function colorState(state: string): string {
  switch (state) {
    case "ready":
      return `\x1b[32m${state.padEnd(10)}\x1b[0m`;
    case "error":
      return `\x1b[31m${state.padEnd(10)}\x1b[0m`;
    case "dirty":
      return `\x1b[33m${state.padEnd(10)}\x1b[0m`;
    default:
      return state.padEnd(10);
  }
}
