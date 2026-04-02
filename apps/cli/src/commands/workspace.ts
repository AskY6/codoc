import { Command } from "commander";
import { resolve } from "node:path";
import type { ApiClient } from "../api-client.js";

export function registerWorkspaceCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  const ws = program
    .command("workspace")
    .description("Manage workspaces");

  ws.command("list")
    .description("List all registered workspaces")
    .action(async () => {
      const client = getClient();
      const list = await client.listWorkspaces();

      if (list.length === 0) {
        console.log("No workspaces registered. Run `cobook init` in a project directory.");
        return;
      }

      // Simple table output
      const header = padRow("NAME", "ID", "PATH");
      const sep = "-".repeat(header.length);
      console.log(header);
      console.log(sep);
      for (const ws of list) {
        console.log(padRow(ws.name, ws.id.slice(0, 8), ws.rootPath));
      }
    });

  ws.command("add")
    .description("Register an existing workspace directory")
    .argument("<path>", "Path to workspace directory")
    .action(async (path: string) => {
      const client = getClient();
      const absPath = resolve(path);
      const result = await client.registerWorkspace(absPath);
      console.log(`Workspace registered: ${result.name} (${result.id.slice(0, 8)})`);
    });

  ws.command("remove")
    .description("Unregister a workspace (does not delete files)")
    .argument("<id>", "Workspace ID")
    .action(async (id: string) => {
      const client = getClient();
      await client.deleteWorkspace(id);
      console.log("Workspace removed.");
    });
}

function padRow(col1: string, col2: string, col3: string): string {
  return `${col1.padEnd(20)} ${col2.padEnd(10)} ${col3}`;
}
