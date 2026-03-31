import { HandlerRegistry } from "./bus.js";
import { assembleContext } from "./context.js";
import { SessionEventEmitter } from "./events.js";
import { type SessionData, buildMessage, createSession } from "./session.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("chat");
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
  /** The participant ID that handles all human messages. */
  handlerId?: string;
}

export function createChatAbility(config?: ChatAbilityConfig): ChatAbility {
  const sessions = new Map<string, SessionData>();
  const emitters = new Map<string, SessionEventEmitter>();
  const registries = new Map<string, HandlerRegistry>();

  const handlerId = config?.handlerId ?? "cobook-assistant";

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

  function getRegistry(sessionId: string): HandlerRegistry {
    const r = registries.get(sessionId);
    if (!r) throw new Error(`Session not found: ${sessionId}`);
    return r;
  }

  /**
   * Internal: dispatch a human message to the registered handler.
   *
   * Only human messages are dispatched. Agent replies are stored and
   * broadcast but never re-routed — agent-to-agent chaining is handled
   * inside the handler itself (via NLRouter / scene agents).
   */
  async function dispatchToHandler(
    sessionId: string,
    message: Message,
  ): Promise<void> {
    // Only route human messages to the handler
    if (message.sender.kind !== "human") return;

    const session = getSession(sessionId);
    const registry = getRegistry(sessionId);
    const emitter = getEmitter(sessionId);

    const handler = registry.get(handlerId);
    if (!handler) return;

    const participant = session.participants.find((p) => p.id === handlerId);

    // Signal that the handler is thinking
    emitter.emit("onTypingChange", handlerId, true);

    // Assemble context
    const requirements = participant?.contextRequirements ?? [];
    let contextData: ContextData[];
    try {
      contextData = await assembleContext(
        requirements,
        session.contextSources,
        session.contextSourceFactories,
        session.activeResourceRefs,
      );
    } catch (err) {
      log.error("context assembly failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      emitter.emit("onTypingChange", handlerId, false);
      return;
    }

    // Call the handler
    let action: Awaited<ReturnType<AgentHandler>>;
    try {
      action = await handler(contextData, message);
    } catch (handlerErr) {
      log.error("handler threw", {
        sessionId,
        handlerId,
        error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
      });
      emitter.emit("onTypingChange", handlerId, false);
      return;
    }

    // Done thinking
    emitter.emit("onTypingChange", handlerId, false);

    if (!action) return;

    if (action.type === "reply") {
      registry.recordResponse(handlerId);
      const replyMessage = buildMessage(action.message);
      const parentId = session.messageTree.getActiveLeafId();
      session.messageTree.addMessage(replyMessage, parentId);
      emitter.emit("onMessage", replyMessage);
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
      registries.set(id, new HandlerRegistry());
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
      getRegistry(sessionId).register(participantId, handler);
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

      // Fire-and-forget: dispatch to handler asynchronously.
      // Agent responses are added to the session as they complete.
      dispatchToHandler(sessionId, message).catch((err) => {
        log.error("dispatch failed", {
          sessionId,
          messageId: message.id,
          error: err instanceof Error ? err.message : String(err),
        });
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
