import { Command } from "commander";
import type { ApiClient } from "../api-client.js";
import { requireWorkspaceId } from "../require-workspace.js";

export function registerBuildCommand(
  program: Command,
  getClient: () => ApiClient,
): void {
  program
    .command("build")
    .description("Parse all codocs, build DAG, and validate")
    .action(async () => {
      const client = getClient();
      const wsId = requireWorkspaceId(program);

      console.log("Building...");
      const result = await client.build(wsId);

      console.log(`Codocs: ${result.codocCount}  Edges: ${result.edgeCount}`);

      if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const err of result.errors) {
          const prefix =
            err.kind === "cycle"
              ? "\x1b[31m[cycle]\x1b[0m"
              : err.kind === "broken-ref"
                ? "\x1b[31m[broken-ref]\x1b[0m"
                : err.kind === "parse-error"
                  ? "\x1b[33m[parse]\x1b[0m"
                  : `[${err.kind}]`;
          console.log(`  ${prefix} ${err.message}`);
        }
      }

      if (result.ok) {
        console.log("\n\x1b[32mBuild OK\x1b[0m");
      } else {
        console.log("\n\x1b[31mBuild failed\x1b[0m");
        process.exitCode = 1;
      }
    });
}
