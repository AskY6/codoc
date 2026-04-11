import type { ToolId } from "./ids.js";
import type { Tool } from "./tool.js";

/**
 * Lookup surface for tools. Agents are given a registry at
 * construction time and resolve tool ids through it; they never
 * own a global singleton.
 *
 * The registry is read-only from the agent's point of view. How
 * the registry is populated (code-based config, plugin loader,
 * remote discovery) is an application concern and lives outside
 * this package.
 */
export interface ToolRegistry {
  readonly get: (id: ToolId) => Tool | undefined;
  readonly list: () => readonly Tool[];
}
