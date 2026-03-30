import { ChatBus, findTriggeredParticipants } from "./bus.js";
import { assembleContext } from "./context.js";
import { SessionEventEmitter } from "./events.js";
import { type SessionData, buildMessage, createSession } from "./session.js";
import type {
  AgentHandler,
  ChatEvents,
  ContextData,
  ContextSource,
  ContextSourceFactory,
  Intent,
  Message,
  NewMessage,
  Participant,
  ResourceRef,
  SessionConfig,
  Unsubscribe,
} from "./types.js";

export type { ChatEvents, Intent, Message, NewMessage, Participant } from "./types.js";
export type { ResourceRef, ParticipantRef, ResponseMode } from "./types.js";
export type { ContextRequirement, ContextSource, ContextData } from "./types.js";
export type { ContextSourceFactory, AgentHandler } from "./types.js";
export type { SessionConfig, Unsubscribe } from "./types.js";
export { assembleContext } from "./context.js";
export { findTriggeredParticipants, matchesTriggerFilter } from "./bus.js";
export type { BusConfig } from "./bus.js";

export interface ChatAbility {
  createSession(config?: SessionConfig): string;
  registerParticipant(sessionId: string, participant: Participant): void;

  // Context management (Phase 2)
  registerContextSource(sessionId: string, source: ContextSource): void;
  registerContextSourceFactory(
    sessionId: string,
    factory: ContextSourceFactory,
  ): void;
  addResourceRef(sessionId: string, ref: ResourceRef): void;
  removeResourceRef(sessionId: string, refId: string): void;

  // Agent handler registration (Phase 2 — executors plug in here)
  registerAgentHandler(
    sessionId: string,
    participantId: string,
    handler: AgentHandler,
  ): void;

  // Messaging
  sendMessage(sessionId: string, msg: NewMessage): Message;
  getMessages(sessionId: string): Message[];
  getParticipants(sessionId: string): Participant[];

  // Intent lifecycle
  updateIntentStatus(
    sessionId: string,
    msgId: string,
    intentIdx: number,
    status: Intent["status"],
  ): void;
  getIntent(sessionId: string, msgId: string, intentIdx: number): Intent;

  // Branching
  branchAt(sessionId: string, messageId: string): string;
  switchBranch(sessionId: string, leafMessageId: string): void;

  // Events
  on<K extends keyof ChatEvents>(
    sessionId: string,
    event: K,
    handler: ChatEvents[K],
  ): Unsubscribe;
}

let sessionCounter = 0;

export interface ChatAbilityConfig {
  maxChainDepth?: number;
  cooldownMs?: number;
}

export function createChatAbility(config?: ChatAbilityConfig): ChatAbility {
  const sessions = new Map<string, SessionData>();
  const emitters = new Map<string, SessionEventEmitter>();
  const buses = new Map<string, ChatBus>();

  function getSession(sessionId: string): SessionData {
    const s = sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    return s;
  }

  function getEmitter(sessionId: string): SessionEventEmitter {
    const e = emitters.get(sessionId);
    if (!e) throw new Error(`Session not found: ${sessionId}`);
    return e;
  }

  function getBus(sessionId: string): ChatBus {
    const b = buses.get(sessionId);
    if (!b) throw new Error(`Session not found: ${sessionId}`);
    return b;
  }

  /**
   * Internal: run message through the bus, assembling context and calling
   * agent handlers. Fires agent replies back into the session recursively
   * with chain depth tracking.
   */
  async function routeMessage(
    sessionId: string,
    message: Message,
    chainDepth: number,
    triggeredInChain: Set<string>,
  ): Promise<void> {
    const session = getSession(sessionId);
    const bus = getBus(sessionId);
    const emitter = getEmitter(sessionId);
    const busConfig = bus.getConfig();

    if (chainDepth >= busConfig.maxChainDepth) {
      console.log(`[chat-bus] chain depth ${chainDepth} >= max ${busConfig.maxChainDepth}, skipping`);
      return;
    }

    const triggered = findTriggeredParticipants(
      message,
      session.participants,
    );

    console.log(
      `[chat-bus] routeMessage from="${message.sender.id}" content="${message.content.slice(0, 50)}" triggered=[${triggered.join(",")}]`,
    );

    for (const agentId of triggered) {
      // Dedup: same agent + same trigger message
      const dedupKey = `${agentId}:${message.id}`;
      if (triggeredInChain.has(dedupKey)) {
        console.log(`[chat-bus] ${agentId} deduped (key=${dedupKey})`);
        continue;
      }
      triggeredInChain.add(dedupKey);

      // Cooldown check for daemon agents
      const participant = session.participants.find((p) => p.id === agentId);
      if (participant?.responseMode.type === "daemon" && bus.isOnCooldown(agentId)) {
        console.log(`[chat-bus] ${agentId} on cooldown, skipping`);
        continue;
      }

      const handler = bus.getHandler(agentId);
      if (!handler) continue;

      // Signal that this agent is thinking
      emitter.emit("onTypingChange", agentId, true);

      // Assemble context for this agent
      const requirements = participant?.contextRequirements ?? [];
      let contextData: ContextData[];
      try {
        contextData = await assembleContext(
          requirements,
          session.contextSources,
          session.contextSourceFactories,
          session.activeResourceRefs,
        );
      } catch {
        emitter.emit("onTypingChange", agentId, false);
        continue;
      }

      // Call the agent handler
      let action: Awaited<ReturnType<AgentHandler>>;
      try {
        action = await handler(contextData, message);
      } catch {
        emitter.emit("onTypingChange", agentId, false);
        continue;
      }

      // Done thinking
      emitter.emit("onTypingChange", agentId, false);

      if (!action) continue;

      if (action.type === "reply") {
        bus.recordResponse(agentId);
        const replyMessage = buildMessage(action.message);
        const parentId = session.messageTree.getActiveLeafId();
        session.messageTree.addMessage(replyMessage, parentId);
        emitter.emit("onMessage", replyMessage);

        // Recurse: agent reply may trigger other agents
        await routeMessage(
          sessionId,
          replyMessage,
          chainDepth + 1,
          triggeredInChain,
        );
      }
      // "open-thread" action — deferred to Phase 6
    }
  }

  const ability: ChatAbility = {
    createSession(cfg?: SessionConfig): string {
      const id = cfg?.id ?? `session_${++sessionCounter}`;
      if (sessions.has(id)) {
        throw new Error(`Session already exists: ${id}`);
      }
      sessions.set(id, createSession(id));
      emitters.set(id, new SessionEventEmitter());
      buses.set(
        id,
        new ChatBus({
          maxChainDepth: config?.maxChainDepth,
          cooldownMs: config?.cooldownMs,
        }),
      );
      return id;
    },

    registerParticipant(sessionId: string, participant: Participant): void {
      const session = getSession(sessionId);
      if (session.participants.some((p) => p.id === participant.id)) {
        throw new Error(
          `Participant already registered: ${participant.id}`,
        );
      }
      session.participants.push(participant);
      getEmitter(sessionId).emit("onParticipantJoin", participant);
    },

    registerContextSource(sessionId: string, source: ContextSource): void {
      const session = getSession(sessionId);
      session.contextSources.push(source);
    },

    registerContextSourceFactory(
      sessionId: string,
      factory: ContextSourceFactory,
    ): void {
      const session = getSession(sessionId);
      session.contextSourceFactories.push(factory);
    },

    addResourceRef(sessionId: string, ref: ResourceRef): void {
      const session = getSession(sessionId);
      if (!session.activeResourceRefs.some((r) => r.id === ref.id)) {
        session.activeResourceRefs.push(ref);
      }
    },

    removeResourceRef(sessionId: string, refId: string): void {
      const session = getSession(sessionId);
      session.activeResourceRefs = session.activeResourceRefs.filter(
        (r) => r.id !== refId,
      );
    },

    registerAgentHandler(
      sessionId: string,
      participantId: string,
      handler: AgentHandler,
    ): void {
      const session = getSession(sessionId);
      if (!session.participants.some((p) => p.id === participantId)) {
        throw new Error(`Participant not registered: ${participantId}`);
      }
      getBus(sessionId).registerHandler(participantId, handler);
    },

    sendMessage(sessionId: string, msg: NewMessage): Message {
      const session = getSession(sessionId);
      const message = buildMessage(msg);

      // Auto-merge message resourceRefs into session activeResourceRefs
      // so context assembly can find matching context sources.
      if (message.resourceRefs) {
        for (const ref of message.resourceRefs) {
          if (!session.activeResourceRefs.some((r) => r.id === ref.id)) {
            session.activeResourceRefs.push(ref);
          }
        }
      }

      const parentId = session.messageTree.getActiveLeafId();
      session.messageTree.addMessage(message, parentId);
      getEmitter(sessionId).emit("onMessage", message);

      // Fire-and-forget: route message through bus asynchronously.
      // Agent responses are added to the session as they complete.
      routeMessage(sessionId, message, 0, new Set()).catch((err) => {
        console.error("[chat-bus] routeMessage error:", err);
      });

      return message;
    },

    getMessages(sessionId: string): Message[] {
      const session = getSession(sessionId);
      return session.messageTree.getActiveBranch();
    },

    getParticipants(sessionId: string): Participant[] {
      const session = getSession(sessionId);
      return [...session.participants];
    },

    updateIntentStatus(
      sessionId: string,
      msgId: string,
      intentIdx: number,
      status: Intent["status"],
    ): void {
      const session = getSession(sessionId);
      const node = session.messageTree.getNode(msgId);
      if (!node) throw new Error(`Message not found: ${msgId}`);
      const intents = node.message.intents;
      if (!intents || intentIdx < 0 || intentIdx >= intents.length) {
        throw new Error(`Intent not found at index ${intentIdx}`);
      }
      intents[intentIdx] = { ...intents[intentIdx], status };
      getEmitter(sessionId).emit(
        "onIntentStatusChange",
        msgId,
        intentIdx,
        status,
      );
    },

    getIntent(
      sessionId: string,
      msgId: string,
      intentIdx: number,
    ): Intent {
      const session = getSession(sessionId);
      const node = session.messageTree.getNode(msgId);
      if (!node) throw new Error(`Message not found: ${msgId}`);
      const intents = node.message.intents;
      if (!intents || intentIdx < 0 || intentIdx >= intents.length) {
        throw new Error(`Intent not found at index ${intentIdx}`);
      }
      return intents[intentIdx];
    },

    branchAt(sessionId: string, messageId: string): string {
      const session = getSession(sessionId);
      return session.messageTree.branchAt(messageId);
    },

    switchBranch(sessionId: string, leafMessageId: string): void {
      const session = getSession(sessionId);
      const activePath = session.messageTree.switchBranch(leafMessageId);
      getEmitter(sessionId).emit("onBranchSwitch", activePath);
    },

    on<K extends keyof ChatEvents>(
      sessionId: string,
      event: K,
      handler: ChatEvents[K],
    ): Unsubscribe {
      getSession(sessionId);
      return getEmitter(sessionId).on(event, handler);
    },
  };

  return ability;
}
