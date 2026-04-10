import { Command } from "commander";
import { createApiClient } from "./api-client.js";
import { registerServerCommand } from "./commands/server.js";
import { registerWorkspaceCommand } from "./commands/workspace.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerShowCommand } from "./commands/show.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerResolveCommand } from "./commands/resolve.js";
import { registerChatCommand } from "./commands/chat.js";

const program = new Command();

program
  .name("cobook")
  .description("Cobook — composable knowledge workspace")
  .version("0.0.0")
  .option(
    "--server-url <url>",
    "Server URL",
    process.env["COBOOK_SERVER_URL"] ?? "http://localhost:3100",
  )
  .option("--workspace <id>", "Workspace ID");

// Lazy API client — created on first use so global opts are parsed
function getClient() {
  return createApiClient(program.opts()["serverUrl"] as string);
}

// Register commands
registerServerCommand(program);
registerWorkspaceCommand(program, getClient);
registerBuildCommand(program, getClient);
registerStatusCommand(program, getClient);
registerShowCommand(program, getClient);
registerGraphCommand(program, getClient);
registerResolveCommand(program, getClient);
registerChatCommand(program, getClient);

// Global error handler
program.parseAsync().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
});
