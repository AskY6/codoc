import { existsSync } from "node:fs";
import { resolve, dirname, parse as parsePath } from "node:path";
import type { ApiClient, WorkspaceDTO } from "./api-client.js";

/**
 * Walk CWD upwards looking for cobook.yaml to determine workspace root.
 * Returns the absolute directory path containing cobook.yaml, or undefined.
 */
export function findWorkspaceRoot(from: string = process.cwd()): string | undefined {
  let dir = resolve(from);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (existsSync(resolve(dir, "cobook.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve the active workspace ID.
 * Priority: --workspace flag > CWD-based discovery > error.
 */
export async function resolveWorkspaceId(
  client: ApiClient,
  explicitId?: string,
): Promise<string> {
  // 1. Explicit --workspace flag
  if (explicitId) return explicitId;

  // 2. CWD-based discovery
  const root = findWorkspaceRoot();
  if (!root) {
    throw new Error(
      "Not inside a cobook workspace (no cobook.yaml found). Run `cobook init` or use --workspace <id>.",
    );
  }

  const matches = await client.listWorkspaces(root);
  if (matches.length > 0) {
    return matches[0]!.id;
  }

  // Workspace exists on disk but not registered with server
  throw new Error(
    `Workspace at ${root} is not registered with the server. Run \`cobook init\` to register it.`,
  );
}
