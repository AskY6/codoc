import { Command } from "commander";
import type { ApiClient } from "../api-client.js";

export function registerWorkspaceCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  const ws = program
    .command("workspace")
    .description("Manage workspaces");

  ws.command("list")
    .description("List all workspaces")
    .action(async () => {
      const client = getClient();
      const list = await client.listWorkspaces();

      if (list.length === 0) {
        console.log("No workspaces. Create one with `cobook workspace create <name>`.");
        return;
      }

      const header = padRow("NAME", "ID");
      const sep = "-".repeat(header.length);
      console.log(header);
      console.log(sep);
      for (const w of list) {
        console.log(padRow(w.name, w.id.slice(0, 8)));
      }
    });

  ws.command("create")
    .description("Create a new workspace")
    .argument("<name>", "Workspace name")
    .action(async (name: string) => {
      const client = getClient();
      const result = await client.createWorkspace(name);
      console.log(`Workspace created: ${result.name} (${result.id.slice(0, 8)})`);
    });

  ws.command("remove")
    .description("Remove a workspace")
    .argument("<id>", "Workspace ID")
    .action(async (id: string) => {
      const client = getClient();
      await client.deleteWorkspace(id);
      console.log("Workspace removed.");
    });
}

function padRow(col1: string, col2: string): string {
  return `${col1.padEnd(24)} ${col2}`;
}
