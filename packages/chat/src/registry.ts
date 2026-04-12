// Map-based registry builders for chat agents and tools.

import type { AgentId } from "@cobook/core";
import type { ToolId } from "@cobook/graph";
import type {
  ChatAgent,
  ChatAgentRegistry,
  ChatTool,
  ChatToolRegistry,
} from "./state/aliases.js";

export function buildChatAgentRegistry(
  agents: readonly ChatAgent[],
): ChatAgentRegistry {
  const map = new Map<AgentId, ChatAgent>();
  for (const agent of agents) {
    map.set(agent.id, agent);
  }
  return {
    get: (id) => map.get(id),
    list: () => agents,
  };
}

export function buildChatToolRegistry(
  tools: readonly ChatTool[],
): ChatToolRegistry {
  const map = new Map<ToolId, ChatTool>();
  for (const tool of tools) {
    map.set(tool.schema.id, tool);
  }
  return {
    get: (id) => map.get(id),
    list: () => tools,
  };
}
