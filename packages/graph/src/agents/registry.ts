import type { AgentId } from "@cobook/core";
import type { Agent } from "./agent.js";

/**
 * Lookup surface for runtime agents. Higher layers (chat runner,
 * service layer) resolve an `AgentListing.id` to a runtime `Agent`
 * through this registry.
 *
 * The registry is read-only from a consumer's point of view.
 * Population strategy — code-registered, plugin-discovered,
 * remotely-loaded — lives outside this package.
 */
export interface AgentRegistry {
  readonly get: (id: AgentId) => Agent | undefined;
  readonly list: () => readonly Agent[];
}
