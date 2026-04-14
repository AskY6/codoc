// Router agent — pure Haiku classifier, no tools.
//
// Reads the latest user message from state.messages, calls the LLM
// with structured output to classify which specialist should handle
// the request, and returns { activeAgent } as a state update.
//
// The graph executor then uses a conditional edge to transition to
// the chosen specialist node.

import type { AgentId } from "@cobook/core";
import type { NodeContext } from "@cobook/graph";
import { ModelId } from "@cobook/graph";
import type { ChatAgent } from "../state/aliases.js";
import type { ChatEvent } from "../state/events.js";
import type { ChatState } from "../state/state.js";
import type { ChatRunContext } from "../runner/context.js";

const ROUTER_MODEL = ModelId("claude-haiku-4-5-20251001");

interface RoutableAgent {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
}

export function createRouterAgent(
  availableAgents: readonly RoutableAgent[],
): ChatAgent {
  const agentListText = availableAgents
    .map((a) => `- id: "${a.id}" — ${a.name}: ${a.description}`)
    .join("\n");

  const systemPrompt = `You are a request router. Your job is to classify the user's message and decide which specialist agent should handle it.

Available agents:
${agentListText}

Respond with ONLY a JSON object: {"route": "<agent_id>"}

Choose the agent whose description best matches the user's intent. If no specialist is a clear match, choose the general-purpose agent.`;

  const routerAgentId = "router" as AgentId;

  return {
    id: routerAgentId,
    name: "Router",
    description: "Routes messages to the appropriate specialist agent",
    model: ROUTER_MODEL,
    systemPrompt,
    tools: [],
    async run(
      state: ChatState,
      ctx: NodeContext<ChatEvent>,
    ): Promise<Partial<ChatState>> {
      const chatCtx = ctx as ChatRunContext;

      // Find the latest user message.
      const userMessages = state.messages.filter((m) => m.kind === "user");
      const latestUser = userMessages[userMessages.length - 1];
      if (!latestUser) {
        // No user message → fall through to default agent.
        return { activeAgent: availableAgents[0]?.id ?? null };
      }

      const response = await chatCtx.llm.createMessage({
        model: chatCtx.modelConfig?.routerModel ?? "claude-haiku-4-5-20251001",
        maxTokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: latestUser.content }],
        signal: chatCtx.signal,
      });

      // Parse the response to extract route.
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      let chosenId: AgentId | null = null;
      try {
        const parsed = JSON.parse(text) as { route?: string };
        if (parsed.route) {
          const match = availableAgents.find(
            (a) => a.id === parsed.route,
          );
          if (match) chosenId = match.id;
        }
      } catch {
        // Parse failed — fall through to default.
      }

      // Fallback: first agent in the list (general assistant).
      if (!chosenId) {
        chosenId = availableAgents[0]?.id ?? null;
      }

      if (chosenId) {
        ctx.emit({
          kind: "agentHandoff",
          from: routerAgentId,
          to: chosenId,
        });
      }

      return { activeAgent: chosenId };
    },
  };
}
