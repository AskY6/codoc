// General assistant specialist — default fallback agent.
//
// Uses Sonnet with platform tools. The tool-call loop runs inside
// `run()`, transparent to the graph executor.

import type { AgentId } from "@cobook/core";
import type { NodeContext, NodeId } from "@cobook/graph";
import { ModelId } from "@cobook/graph";
import type { ChatAgent, ChatTool } from "../state/aliases.js";
import type { ChatEvent } from "../state/events.js";
import type { ChatState } from "../state/state.js";
import type { ChatRunContext } from "../runner/context.js";
import { runToolLoop } from "./run-tool-loop.js";

const GENERAL_MODEL = ModelId("claude-sonnet-4-20250514");

const GENERAL_SYSTEM_PROMPT = `You are the Cobook assistant — a helpful AI that operates within a Cobook workspace.

A Cobook workspace contains codoc documents (structured documents with metadata, data, and view sections) that form a dependency graph (DAG). You can:

- List all codocs and their states
- Read individual codoc content and resolved data
- Check workspace status (node state distribution)
- Create new codocs
- Update existing codocs
- Delete codocs

When the user asks about their workspace, use the tools to get accurate information rather than guessing. Be concise and helpful. When creating or updating codocs, generate valid content that follows the codoc format.`;

export function createGeneralAgent(
  agentId: AgentId,
  tools: readonly ChatTool[],
): ChatAgent {
  return {
    id: agentId,
    name: "Cobook Assistant",
    description: "General workspace assistant",
    model: GENERAL_MODEL,
    systemPrompt: GENERAL_SYSTEM_PROMPT,
    tools,
    async run(
      state: ChatState,
      ctx: NodeContext<ChatEvent>,
    ): Promise<Partial<ChatState>> {
      return runToolLoop({
        agentId,
        nodeId: agentId as unknown as NodeId,
        model: "claude-sonnet-4-20250514",
        systemPrompt: GENERAL_SYSTEM_PROMPT,
        tools,
        state,
        ctx: ctx as ChatRunContext,
      });
    },
  };
}
