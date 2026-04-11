import type { ToolId } from "./ids.js";
import type { Tool } from "./tool.js";

/**
 * Lookup surface for tools, generic over the graph's state `S`
 * and event `E`. A registry only holds tools of a single `S` / `E`
 * combination; mixing state shapes inside one registry is a
 * category error.
 *
 * Agents are given a registry at construction time and resolve
 * tool ids through it; they never own a global singleton. How the
 * registry is populated (code-based config, plugin loader, remote
 * discovery) is an application concern and lives outside this
 * package.
 */
export interface ToolRegistry<S, E> {
  readonly get: (id: ToolId) => Tool<S, E> | undefined;
  readonly list: () => readonly Tool<S, E>[];
}
