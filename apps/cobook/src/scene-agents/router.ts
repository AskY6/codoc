import type { SceneAgent } from "./types.js";
import type { SceneAgentRegistry } from "./registry.js";
import { getClient, getModel } from "../shared/ai.js";

export interface ResourceRef {
  kind: string;
  id: string;
  label?: string;
}

export interface RouteOptions {
  resourceRefs?: ResourceRef[];
}

export type RouteResult =
  | { type: "matched"; agentId: string }
  | { type: "ambiguous"; candidates: string[] }
  | { type: "none" };

/**
 * NL Router — routes user messages to the most appropriate scene agent.
 *
 * Uses LLM-based classification with agent descriptions as context.
 * Falls back to keyword matching for low-latency cases.
 * Also considers resourceRefs to bias routing when text alone is ambiguous.
 */
export class NLRouter {
  private registry: SceneAgentRegistry;

  constructor(registry: SceneAgentRegistry) {
    this.registry = registry;
  }

  async route(userMessage: string, opts?: RouteOptions): Promise<RouteResult> {
    const activeAgents = this.registry.listActive();
    if (activeAgents.length === 0) return { type: "none" };
    if (activeAgents.length === 1)
      return { type: "matched", agentId: activeAgents[0].id };

    const keywordResult = this.keywordMatch(userMessage, activeAgents);
    if (keywordResult.type === "matched") return keywordResult;

    // Use resourceRefs as a routing hint when keywords are ambiguous/none
    const refResult = this.resourceRefMatch(opts?.resourceRefs, activeAgents);
    if (refResult.type === "matched") return refResult;

    return this.llmRoute(userMessage, activeAgents, opts?.resourceRefs);
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
      "codoc-agent": [
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

  /**
   * Match based on resourceRef patterns. Session docs (id starting with
   * "session-") route to claude-log; other codoc refs route to codoc-agent.
   */
  private resourceRefMatch(
    refs: ResourceRef[] | undefined,
    agents: SceneAgent[],
  ): RouteResult {
    if (!refs || refs.length === 0) return { type: "none" };

    const agentIds = new Set(agents.map((a) => a.id));
    const hasSessionRef = refs.some(
      (r) => r.kind === "codoc" && r.id.startsWith("session-"),
    );
    const hasCodocRef = refs.some(
      (r) => r.kind === "codoc" && !r.id.startsWith("session-"),
    );

    if (hasSessionRef && !hasCodocRef && agentIds.has("claude-log")) {
      return { type: "matched", agentId: "claude-log" };
    }
    if (hasCodocRef && !hasSessionRef && agentIds.has("codoc-agent")) {
      return { type: "matched", agentId: "codoc-agent" };
    }
    if (hasSessionRef && hasCodocRef) {
      const candidates = [];
      if (agentIds.has("claude-log")) candidates.push("claude-log");
      if (agentIds.has("codoc-agent")) candidates.push("codoc-agent");
      if (candidates.length > 0)
        return { type: "ambiguous", candidates };
    }

    return { type: "none" };
  }

  private async llmRoute(
    message: string,
    agents: SceneAgent[],
    refs?: ResourceRef[],
  ): Promise<RouteResult> {
    const agentList = agents
      .map((a) => `- ${a.id}: ${a.description}`)
      .join("\n");

    const refContext =
      refs && refs.length > 0
        ? `\n\nAttached resources: ${refs.map((r) => `${r.kind}:${r.id}`).join(", ")}`
        : "";

    const client = getClient();
    const response = await client.messages.create({
      model: getModel(),
      max_tokens: 100,
      system: `You are a message router. Given a user message and a list of available agents, determine which agent should handle the request. Respond with ONLY the agent ID, or "NONE" if no agent matches, or "AMBIGUOUS:id1,id2" if multiple agents could handle it.`,
      messages: [
        {
          role: "user",
          content: `Available agents:\n${agentList}\n\nUser message: "${message}"${refContext}`,
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
