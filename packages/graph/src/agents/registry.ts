import type { AgentId } from "@cobook/core";
import type { Agent } from "./agent.js";

/**
 * Lookup surface for runtime agents, generic over the graph's
 * state `S` and event `E`. A registry only holds agents of a
 * single `S` / `E` combination; mixing state shapes inside one
 * registry is a category error.
 *
 * Higher layers (chat runner, service layer) resolve an
 * `AgentListing.id` to a runtime `Agent` through this registry.
 *
 * The registry is read-only from a consumer's point of view.
 * Population strategy — code-registered, plugin-discovered,
 * remotely-loaded — lives outside this package.
 */
export interface AgentRegistry<S, E> {
  readonly get: (id: AgentId) => Agent<S, E> | undefined;
  readonly list: () => readonly Agent<S, E>[];
}
