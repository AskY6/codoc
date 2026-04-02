import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { resolveWorkspaceId } from "../workspace-discovery.js";

export function registerShowCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("show")
    .description("Show a codoc's meta, resolved data, and view definition")
    .argument("<path>", "Codoc path (e.g. notes/meeting.codoc)")
    .action(async (path: string) => {
      const client = getClient();
      const wsId = await resolveWorkspaceId(
        client,
        program.opts()["workspace"] as string | undefined,
      );

      const info = await client.getCodoc(wsId, path);

      // Meta
      const ast = info.ast as Record<string, unknown> | null;
      if (ast?.["meta"]) {
        console.log("\x1b[1m--- meta ---\x1b[0m");
        console.log(JSON.stringify(ast["meta"], null, 2));
      }

      // Resolved data
      if (info.resolvedData) {
        console.log("\n\x1b[1m--- data (resolved) ---\x1b[0m");
        console.log(JSON.stringify(info.resolvedData, null, 2));
      } else if (ast?.["data"]) {
        console.log("\n\x1b[1m--- data (raw) ---\x1b[0m");
        console.log(JSON.stringify(ast["data"], null, 2));
      }

      // View
      if (ast?.["view"]) {
        console.log("\n\x1b[1m--- view ---\x1b[0m");
        console.log(JSON.stringify(ast["view"], null, 2));
      }

      // State
      console.log(`\nState: ${info.nodeState}`);
    });
}
