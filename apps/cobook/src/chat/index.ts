import { SessionEventEmitter } from "./events.js";
import {
  type SessionData,
  MessageTree,
  buildMessage,
  createSession,
} from "./session.js";
import type {
  ChatEvents,
  Intent,
  Message,
  NewMessage,
  Participant,
  SessionConfig,
  Unsubscribe,
} from "./types.js";

export type { ChatEvents, Intent, Message, NewMessage, Participant } from "./types.js";
export type { ResourceRef, ParticipantRef, ResponseMode } from "./types.js";
export type { ContextRequirement, ContextSource, ContextData } from "./types.js";
export type { SessionConfig, Unsubscribe } from "./types.js";

export interface ChatAbility {
  createSession(config?: SessionConfig): string;
  registerParticipant(sessionId: string, participant: Participant): void;
  sendMessage(sessionId: string, msg: NewMessage): Message;
  getMessages(sessionId: string): Message[];
  getParticipants(sessionId: string): Participant[];
  updateIntentStatus(
    sessionId: string,
    msgId: string,
    intentIdx: number,
    status: Intent["status"],
  ): void;
  getIntent(sessionId: string, msgId: string, intentIdx: number): Intent;
  branchAt(sessionId: string, messageId: string): string;
  switchBranch(sessionId: string, leafMessageId: string): void;
  on<K extends keyof ChatEvents>(
    sessionId: string,
    event: K,
    handler: ChatEvents[K],
  ): Unsubscribe;
}

let sessionCounter = 0;

export function createChatAbility(): ChatAbility {
  const sessions = new Map<string, SessionData>();
  const emitters = new Map<string, SessionEventEmitter>();

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

  const ability: ChatAbility = {
    createSession(config?: SessionConfig): string {
      const id = config?.id ?? `session_${++sessionCounter}`;
      if (sessions.has(id)) {
        throw new Error(`Session already exists: ${id}`);
      }
      sessions.set(id, createSession(id));
      emitters.set(id, new SessionEventEmitter());
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

    sendMessage(sessionId: string, msg: NewMessage): Message {
      const session = getSession(sessionId);
      const message = buildMessage(msg);
      const parentId = session.messageTree.getActiveLeafId();
      session.messageTree.addMessage(message, parentId);
      getEmitter(sessionId).emit("onMessage", message);
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
      const branchPoint = session.messageTree.branchAt(messageId);
      return branchPoint;
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
      getSession(sessionId); // validate session exists
      return getEmitter(sessionId).on(event, handler);
    },
  };

  return ability;
}
