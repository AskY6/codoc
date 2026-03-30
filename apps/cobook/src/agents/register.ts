import type { Workspace } from "@cobook/workspace";
import type { ChatAbility } from "../chat/index.js";
import type { IntentQueue } from "../intent-queue/index.js";
import { IntentQueueConsumer } from "../intent-queue/index.js";
import { SceneAgentRegistry } from "../scene-agents/index.js";
import { NLRouter } from "../scene-agents/index.js";
import { codocAgentParticipant, createCodocAgentHandler, codocAgentExecuteIntent } from "./codoc-agent.js";
import {
  claudeCodeLogAgentParticipant,
  createClaudeCodeLogAgentHandler,
  claudeCodeLogSceneAgent,
} from "./claude-code-log-agent.js";

export const presetAgents = [
  codocAgentParticipant,
  claudeCodeLogAgentParticipant,
];

// ---------------------------------------------------------------------------
// Phase 0–1: Register chat participants + handlers (backward compat)
// ---------------------------------------------------------------------------

export function registerPresetAgents(
  chat: ChatAbility,
  sessionId: string,
): void {
  for (const agent of presetAgents) {
    chat.registerParticipant(sessionId, agent);
  }
}

export function registerPresetAgentHandlers(
  chat: ChatAbility,
  sessionId: string,
): void {
  chat.registerAgentHandler(sessionId, "codoc-agent", createCodocAgentHandler());
  chat.registerAgentHandler(sessionId, "claude-code-log-agent", createClaudeCodeLogAgentHandler());
}

// ---------------------------------------------------------------------------
// Phase 2–4: Full two-layer architecture setup
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
  /** Dispatch a user message through the scene agent layer */
  dispatchToSceneAgents(
    userMessage: string,
    targetDocIds?: string[],
  ): Promise<void>;
}

/**
 * Initialize the full two-layer agent architecture.
 *
 * 1. Register chat participants + handlers (legacy)
 * 2. Set up IntentQueueConsumer (codoc agent as consumer)
 * 3. Register scene agents
 * 4. Wire up NL router
 */
export function initAgentSystem(config: AgentSystemConfig): AgentSystem {
  const { workspace, chat, sessionId, intentQueue } = config;

  // Phase 0–1: Legacy chat integration
  registerPresetAgents(chat, sessionId);
  registerPresetAgentHandlers(chat, sessionId);

  // Phase 1: Intent queue consumer (codoc agent as infrastructure layer)
  const consumer = new IntentQueueConsumer(workspace, intentQueue);
  consumer.setNLExecutor(codocAgentExecuteIntent);

  // Phase 2: Scene agent registry
  const sceneRegistry = new SceneAgentRegistry();
  sceneRegistry.register(claudeCodeLogSceneAgent);

  // Phase 4: NL router
  const router = new NLRouter(sceneRegistry);

  // Bridge: when intents are proposed in chat messages, mirror them to the queue
  chat.on(sessionId, "onMessage", (msg) => {
    if (!msg.intents) return;
    for (const intent of msg.intents) {
      if (intent.status !== "proposed") continue;
      const payload = intent.payload as any;
      const docId = payload?.docId ?? payload?.payload?.docId ?? "unknown";
      const field = payload?.field ?? payload?.payload?.field;
      intentQueue.enqueue({
        source: msg.sender.id,
        target: { docId, field },
        content: `${intent.kind}: ${JSON.stringify(payload)}`,
        payload: { kind: intent.kind, payload },
      });
    }
  });

  // Bridge: when intent status changes in chat, sync to queue
  chat.on(sessionId, "onIntentStatusChange", (msgId, intentIdx, status) => {
    // Find the corresponding queue record and transition it
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

  /**
   * Dispatch a user message through scene agents.
   * Routes to the appropriate scene agent, runs it, and enqueues the produced intents.
   */
  async function dispatchToSceneAgents(
    userMessage: string,
    targetDocIds?: string[],
  ): Promise<void> {
    // Determine target docs
    const docs = targetDocIds ?? workspace.listDocs().map((d) => d.docId);

    // Build context
    const schemas: Record<string, Record<string, unknown>> = {};
    const data: Record<string, Record<string, unknown>> = {};
    for (const docId of docs) {
      const schema = workspace.getDocSchema(docId);
      const docData = workspace.getDocData(docId);
      if (schema) schemas[docId] = schema;
      if (docData) data[docId] = docData;
    }

    // Route to a scene agent
    const routeResult = await router.route(userMessage);

    if (routeResult.type === "none") return;

    const agentIds =
      routeResult.type === "matched"
        ? [routeResult.agentId]
        : routeResult.candidates;

    for (const agentId of agentIds) {
      const agent = sceneRegistry.getAgent(agentId);
      if (!agent) continue;

      const proposals = await agent.handle({
        schemas,
        data,
        userMessage,
      });

      for (const proposal of proposals) {
        intentQueue.enqueue({
          source: agentId,
          target: {
            docId: proposal.targetDocId,
            field: proposal.targetField,
          },
          content: proposal.naturalLanguageIntent,
          trusted: agent.trusted,
        });
      }
    }
  }

  return { consumer, sceneRegistry, router, dispatchToSceneAgents };
}
