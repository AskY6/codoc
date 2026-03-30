import type { Workspace } from "@cobook/workspace";
import type { ChatAbility } from "../chat/index.js";
import type { IntentQueue } from "../intent-queue/index.js";
import { IntentQueueConsumer } from "../intent-queue/index.js";
import { SceneAgentRegistry, NLRouter } from "../scene-agents/index.js";
import type { Participant, AgentHandler } from "../chat/types.js";
import { formatContextForPrompt } from "./utils.js";
import { codocStructureAgent } from "./codoc-structure-agent.js";
import { claudeLogAgent } from "./claude-log-agent.js";

// ---------------------------------------------------------------------------
// Single chat participant — routes to scene agents via NLRouter
// ---------------------------------------------------------------------------

const assistantParticipant: Participant = {
  id: "codoc-assistant",
  kind: "agent",
  name: "Codoc Assistant",
  description: "Workspace assistant that routes requests to specialized agents.",
  contextRequirements: [
    { sourceKind: "chat-history", priority: "required", maxTokens: 3000 },
    { sourceKind: "codoc-snapshot", priority: "optional" },
    { sourceKind: "connector-catalog", priority: "optional", maxTokens: 2000 },
  ],
  responseMode: {
    type: "daemon",
    filter: {},
  },
};

// ---------------------------------------------------------------------------
// Agent system config & init
// ---------------------------------------------------------------------------

export interface AgentSystemConfig {
  workspace: Workspace;
  chat: ChatAbility;
  sessionId: string;
  intentQueue: IntentQueue;
}

export interface AgentSystem {
  consumer: IntentQueueConsumer;
  sceneRegistry: SceneAgentRegistry;
  router: NLRouter;
}

/**
 * Initialize the agent system.
 *
 * Registers a single chat participant ("codoc-assistant") whose handler
 * routes user messages through:
 *   NLRouter → SceneAgent.handle() → IntentQueue → IntentExecutor → Workspace
 */
export function initAgentSystem(config: AgentSystemConfig): AgentSystem {
  const { workspace, chat, sessionId, intentQueue } = config;

  // --- Scene agent layer ---

  const sceneRegistry = new SceneAgentRegistry();
  sceneRegistry.register(codocStructureAgent);
  sceneRegistry.register(claudeLogAgent);
  sceneRegistry.activate(codocStructureAgent.id);
  sceneRegistry.activate(claudeLogAgent.id);

  const router = new NLRouter(sceneRegistry);

  // --- Intent queue consumer ---

  const consumer = new IntentQueueConsumer(workspace, intentQueue);

  // --- Chat integration ---

  chat.registerParticipant(sessionId, assistantParticipant);

  const handler: AgentHandler = async (context, triggerMessage) => {
    const routeResult = await router.route(triggerMessage.content);
    if (routeResult.type === "none") return null;

    const agentId =
      routeResult.type === "matched"
        ? routeResult.agentId
        : routeResult.candidates[0];

    const agent = sceneRegistry.getAgent(agentId);
    if (!agent) return null;

    // Build scene agent context from workspace
    const schemas: Record<string, Record<string, unknown>> = {};
    const data: Record<string, Record<string, unknown>> = {};
    for (const doc of workspace.listDocs()) {
      const schema = workspace.getDocSchema(doc.docId);
      const docData = workspace.getDocData(doc.docId);
      if (schema) schemas[doc.docId] = schema;
      if (docData) data[doc.docId] = docData;
    }

    const result = await agent.handle({
      schemas,
      data,
      userMessage: triggerMessage.content,
      additionalContext: formatContextForPrompt(context),
    });

    // Enqueue proposals into intent queue
    const intents = [];
    for (const proposal of result.proposals) {
      intentQueue.enqueue({
        source: agentId,
        target: { docId: proposal.targetDocId, field: proposal.targetField },
        content: proposal.content,
        payload: proposal.payload,
        trusted: agent.trusted,
      });
      if (proposal.payload) {
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
        sender: { id: "codoc-assistant", kind: "agent" as const },
        content: result.reply,
        intents: intents.length > 0 ? intents : undefined,
      },
    };
  };

  chat.registerAgentHandler(sessionId, "codoc-assistant", handler);

  // Bridge: sync chat intent status changes to the intent queue
  chat.on(sessionId, "onIntentStatusChange", (msgId, intentIdx, status) => {
    const chatIntent = chat.getIntent(sessionId, msgId, intentIdx);
    if (!chatIntent) return;
    const payload = chatIntent.payload as any;
    const docId = payload?.docId ?? payload?.payload?.docId;
    if (!docId) return;

    const records = intentQueue.getAll();
    const match = records.find(
      (r) =>
        r.status === "pending" &&
        r.target.docId === docId &&
        r.payload?.kind === chatIntent.kind,
    );
    if (match && (status === "confirmed" || status === "rejected")) {
      intentQueue.transition(match.id, status);
    }
  });

  return { consumer, sceneRegistry, router };
}
