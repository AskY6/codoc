import {
  createChatAbility,
  type ChatAbility,
  type Message,
} from "@/chat/index";
import { initCodocUse } from "@/codoc-use/index";
import { initAgentSystem, type AgentSystem } from "@/agents/register";
import { getWorkspace } from "./workspace";

type ChatListener = (msg: Message) => void;
type IntentListener = (
  msgId: string,
  intentIdx: number,
  status: "proposed" | "confirmed" | "rejected",
) => void;
type TypingListener = (agentId: string, isTyping: boolean) => void;

const g = globalThis as typeof globalThis & {
  _chat?: ChatAbility;
  _sessionId?: string;
  _agentSystem?: AgentSystem;
  _chatListeners?: Set<ChatListener>;
  _intentListeners?: Set<IntentListener>;
  _typingListeners?: Set<TypingListener>;
  _chatInitPromise?: Promise<void>;
};

if (!g._chatListeners) g._chatListeners = new Set();
if (!g._intentListeners) g._intentListeners = new Set();
if (!g._typingListeners) g._typingListeners = new Set();

async function initChat(): Promise<void> {
  if (g._chat && g._sessionId) return;

  const chat = createChatAbility();
  const sessionId = chat.createSession({ id: "main" });
  const workspace = await getWorkspace();

  // Context sources and event bridges
  initCodocUse(workspace, chat, sessionId);

  // Agent system
  const agentSystem = initAgentSystem({ workspace, chat, sessionId });
  g._agentSystem = agentSystem;

  // Subscribe to events for SSE broadcasting
  chat.on(sessionId, "onMessage", (msg) => {
    for (const fn of g._chatListeners!) fn(msg);
  });

  chat.on(sessionId, "onIntentStatusChange", (msgId, idx, status) => {
    for (const fn of g._intentListeners!) fn(msgId, idx, status);
  });

  chat.on(sessionId, "onTypingChange", (agentId, isTyping) => {
    for (const fn of g._typingListeners!) fn(agentId, isTyping);
  });

  g._chat = chat;
  g._sessionId = sessionId;
}

export async function getChatAbility(): Promise<ChatAbility> {
  if (!g._chatInitPromise) {
    g._chatInitPromise = initChat().catch((err) => {
      // Allow retry on next call instead of caching a rejected promise
      g._chatInitPromise = undefined;
      throw err;
    });
  }
  await g._chatInitPromise;
  return g._chat!;
}

export async function getSessionId(): Promise<string> {
  await getChatAbility();
  return g._sessionId!;
}

export function onChatMessage(fn: ChatListener): () => void {
  g._chatListeners!.add(fn);
  return () => {
    g._chatListeners!.delete(fn);
  };
}

export function onIntentStatusChange(fn: IntentListener): () => void {
  g._intentListeners!.add(fn);
  return () => {
    g._intentListeners!.delete(fn);
  };
}

export function onTypingChange(fn: TypingListener): () => void {
  g._typingListeners!.add(fn);
  return () => {
    g._typingListeners!.delete(fn);
  };
}

export async function getAgentSystem(): Promise<AgentSystem> {
  await getChatAbility();
  return g._agentSystem!;
}
