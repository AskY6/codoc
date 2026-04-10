import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { requireWorkspaceId } from "../require-workspace.js";

export function registerResolveCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("resolve")
    .description("Resolve a node and print its value")
    .argument("<nodeId>", "Node ID (e.g. notes/meeting.codoc#data.summary)")
    .action(async (nodeId: string) => {
      const client = getClient();
      const wsId = requireWorkspaceId(program);

      const result = await client.resolve(wsId, nodeId);
      console.log(JSON.stringify(result.value, null, 2));
    });
}
