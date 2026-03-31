import type { Workspace } from "@cobook/workspace";
import type { ChatAbility } from "../chat/index.js";
import { SceneAgentRegistry, NLRouter } from "./framework/index.js";
import type { Participant, AgentHandler } from "../chat/types.js";
import { formatContextForPrompt } from "./utils.js";
import { executeIntent } from "./executor.js";
import { codocStructureAgent } from "./implementations/codoc-structure-agent.js";
import { claudeLogAgent } from "./implementations/claude-log-agent.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("agent");

// ---------------------------------------------------------------------------
// Single chat participant — routes to scene agents via NLRouter
// ---------------------------------------------------------------------------

const assistantParticipant: Participant = {
  id: "cobook-assistant",
  kind: "agent",
  name: "Cobook Assistant",
  description: "Workspace assistant that routes requests to specialized agents.",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required", maxTokens: 3000 },
    { sourceKind: "codoc-snapshot", priority: "optional" },
    { sourceKind: "connector-catalog", priority: "optional", maxTokens: 2000 },
  ],
};

// ---------------------------------------------------------------------------
// Agent system config & init
// ---------------------------------------------------------------------------

export interface AgentSystemConfig {
  workspace: Workspace;
  chat: ChatAbility;
  sessionId: string;
}

export interface AgentSystem {
  sceneRegistry: SceneAgentRegistry;
  router: NLRouter;
}

/**
 * Initialize the agent system.
 *
 * Registers a single chat participant ("cobook-assistant") whose handler
 * routes user messages through:
 *   NLRouter → SceneAgent.handle() → chat intents → executeIntent → Workspace
 */
export function initAgentSystem(config: AgentSystemConfig): AgentSystem {
  const { workspace, chat, sessionId } = config;

  // --- Scene agent layer ---

  const sceneRegistry = new SceneAgentRegistry();
  sceneRegistry.register(codocStructureAgent);
  sceneRegistry.register(claudeLogAgent);
  sceneRegistry.activate(codocStructureAgent.id);
  sceneRegistry.activate(claudeLogAgent.id);

  const router = new NLRouter(sceneRegistry);

  // --- Chat integration ---

  chat.registerParticipant(sessionId, assistantParticipant);

  const handler: AgentHandler = async (context, triggerMessage) => {
    // Split context: chat-history goes to both router and agent;
    // the rest is domain-specific context only for the agent.
    const chatHistory = context
      .filter((c) => c.kind === "chat-history")
      .map((c) => c.content)
      .join("\n");
    const domainContext = context.filter((c) => c.kind !== "chat-history");

    // --- Route (with chat history) ---
    let routeResult;
    try {
      routeResult = await router.route(triggerMessage.content, {
        resourceRefs: triggerMessage.resourceRefs,
        chatHistory,
      });
    } catch (err) {
      log.error("routing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        type: "reply" as const,
        message: {
          sender: { id: "cobook-assistant", kind: "agent" as const },
          content: "抱歉，消息路由时出错，请稍后重试。",
        },
      };
    }

    log.info("routed", {
      type: routeResult.type,
      agentId: routeResult.type === "matched" ? routeResult.agentId : undefined,
      refs: triggerMessage.resourceRefs?.map((r) => r.id),
    });
    if (routeResult.type === "none") return null;

    const agentId =
      routeResult.type === "matched"
        ? routeResult.agentId
        : routeResult.candidates[0];

    const agent = sceneRegistry.getAgent(agentId);
    if (!agent) {
      log.warn("agent not found after routing", { agentId });
      return null;
    }

    // --- Build scene agent context ---
    const schemas: Record<string, Record<string, unknown>> = {};
    const data: Record<string, Record<string, unknown>> = {};
    for (const doc of workspace.listDocs()) {
      const schema = workspace.getDocSchema(doc.docId);
      const docData = workspace.getDocData(doc.docId);
      if (schema) schemas[doc.docId] = schema;
      if (docData) data[doc.docId] = docData;
    }

    // --- Agent handle ---
    let result;
    try {
      const t0 = Date.now();
      result = await agent.handle({
        schemas,
        data,
        userMessage: triggerMessage.content,
        chatHistory,
        additionalContext: formatContextForPrompt(domainContext),
      });
      log.info("agent handled", {
        agentId,
        durationMs: Date.now() - t0,
        proposals: result.proposals.length,
      });
    } catch (err) {
      log.error("agent handle failed", {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        type: "reply" as const,
        message: {
          sender: { id: agentId, kind: "agent" as const },
          content: "抱歉，处理请求时出错，请稍后重试。",
        },
      };
    }

    // --- Build intents from proposals ---
    const intents = [];
    for (const proposal of result.proposals) {
      if (!proposal.payload) continue;

      if (agent.trusted) {
        // Trusted agents: execute immediately, mark as confirmed
        try {
          await executeIntent(workspace, proposal.payload.kind, proposal.payload.payload);
          intents.push({
            kind: proposal.payload.kind,
            payload: proposal.payload.payload,
            status: "confirmed" as const,
          });
        } catch (err) {
          log.error("trusted intent execution failed", {
            agentId,
            kind: proposal.payload.kind,
            error: err instanceof Error ? err.message : String(err),
          });
          // Fall back to proposed so user can retry
          intents.push({
            kind: proposal.payload.kind,
            payload: proposal.payload.payload,
            status: "proposed" as const,
          });
        }
      } else {
        intents.push({
          kind: proposal.payload.kind,
          payload: proposal.payload.payload,
          status: "proposed" as const,
        });
      }
    }

    return {
      type: "reply" as const,
      message: {
        sender: { id: agentId, kind: "agent" as const },
        content: result.reply,
        intents: intents.length > 0 ? intents : undefined,
      },
    };
  };

  chat.registerAgentHandler(sessionId, "cobook-assistant", handler);

  // Execute intents when user confirms in chat
  chat.on(sessionId, "onIntentStatusChange", async (msgId, intentIdx, status) => {
    if (status !== "confirmed") return;
    const intent = chat.getIntent(sessionId, msgId, intentIdx);
    if (!intent) return;

    try {
      await executeIntent(workspace, intent.kind, intent.payload);
    } catch (err) {
      log.error("intent execution failed", {
        msgId,
        intentIdx,
        kind: intent.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { sceneRegistry, router };
}
