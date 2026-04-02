import { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { basename } from "node:path";
import type { ApiClient } from "../api-client.js";
import { ConnectionError } from "../api-client.js";

export function registerInitCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("init")
    .description("Initialize a new cobook workspace in the current directory")
    .option("-n, --name <name>", "Workspace name")
    .action(async (opts: { name?: string }) => {
      const dir = process.cwd();
      const configPath = resolve(dir, "cobook.yaml");

      if (existsSync(configPath)) {
        console.log("Already initialized — cobook.yaml exists.");
        return;
      }

      const name = opts.name ?? basename(dir);
      writeFileSync(configPath, `name: ${name}\n`, "utf-8");
      console.log(`Created cobook.yaml (workspace: ${name})`);

      // Try to register with server
      try {
        const client = getClient();
        const ws = await client.registerWorkspace(dir);
        console.log(`Registered with server (id: ${ws.id})`);
      } catch (err) {
        if (err instanceof ConnectionError) {
          console.log(
            "Server not running — workspace will be registered on first connection.",
          );
        } else {
          console.log(`Warning: could not register with server: ${err}`);
        }
      }
    });
}
