import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { resolveWorkspaceId } from "../workspace-discovery.js";

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
      const wsId = await resolveWorkspaceId(
        client,
        program.opts()["workspace"] as string | undefined,
      );

      const result = await client.resolve(wsId, nodeId);
      console.log(JSON.stringify(result.value, null, 2));
    });
}
