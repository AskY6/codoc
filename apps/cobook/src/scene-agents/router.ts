import type { SceneAgent } from "./types.js";
import type { SceneAgentRegistry } from "./registry.js";
import { getClient, getModel } from "../shared/ai.js";

export type RouteResult =
  | { type: "matched"; agentId: string }
  | { type: "ambiguous"; candidates: string[] }
  | { type: "none" };

/**
 * NL Router — routes user messages to the most appropriate scene agent.
 *
 * Uses LLM-based classification with agent descriptions as context.
 * Falls back to keyword matching for low-latency cases.
 */
export class NLRouter {
  private registry: SceneAgentRegistry;

  constructor(registry: SceneAgentRegistry) {
    this.registry = registry;
  }

  async route(userMessage: string): Promise<RouteResult> {
    const activeAgents = this.registry.listActive();
    if (activeAgents.length === 0) return { type: "none" };
    if (activeAgents.length === 1)
      return { type: "matched", agentId: activeAgents[0].id };

    const keywordResult = this.keywordMatch(userMessage, activeAgents);
    if (keywordResult.type === "matched") return keywordResult;

    return this.llmRoute(userMessage, activeAgents);
  }

  private keywordMatch(message: string, agents: SceneAgent[]): RouteResult {
    const lower = message.toLowerCase();
    const KEYWORD_MAP: Record<string, string[]> = {
      "claude-log": [
        "日志",
        "session",
        "log",
        "会话",
        "claude code",
        "ingest",
        "接入",
        "导入",
      ],
      "codoc-structure": [
        "创建",
        "新建",
        "搭建",
        "做一个",
        "create",
        "build",
        "make",
        "修改",
        "rewrite",
        "重写",
        "字段",
        "field",
      ],
    };

    const matches: string[] = [];
    for (const agent of agents) {
      const keywords = KEYWORD_MAP[agent.id];
      if (keywords?.some((kw) => lower.includes(kw))) {
        matches.push(agent.id);
      }
    }

    if (matches.length === 1) return { type: "matched", agentId: matches[0] };
    if (matches.length > 1) return { type: "ambiguous", candidates: matches };
    return { type: "none" };
  }

  private async llmRoute(
    message: string,
    agents: SceneAgent[],
  ): Promise<RouteResult> {
    const agentList = agents
      .map((a) => `- ${a.id}: ${a.description}`)
      .join("\n");

    const client = getClient();
    const response = await client.messages.create({
      model: getModel(),
      max_tokens: 100,
      system: `You are a message router. Given a user message and a list of available agents, determine which agent should handle the request. Respond with ONLY the agent ID, or "NONE" if no agent matches, or "AMBIGUOUS:id1,id2" if multiple agents could handle it.`,
      messages: [
        {
          role: "user",
          content: `Available agents:\n${agentList}\n\nUser message: "${message}"`,
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    if (text === "NONE") return { type: "none" };
    if (text.startsWith("AMBIGUOUS:")) {
      const candidates = text
        .slice("AMBIGUOUS:".length)
        .split(",")
        .map((s) => s.trim());
      return { type: "ambiguous", candidates };
    }

    const matchedAgent = agents.find((a) => a.id === text);
    if (matchedAgent) return { type: "matched", agentId: matchedAgent.id };

    return { type: "none" };
  }
}
