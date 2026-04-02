import type { Command } from "commander";

/**
 * Extract the --workspace flag value. Throws if not provided.
 */
export function requireWorkspaceId(program: Command): string {
  const id = program.opts()["workspace"] as string | undefined;
  if (!id) {
    throw new Error(
      "Missing --workspace <id>. Use `cobook workspace list` to find your workspace ID.",
    );
  }
  return id;
}
