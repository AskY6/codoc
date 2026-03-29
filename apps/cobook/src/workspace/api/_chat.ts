import { createChatAbility, type ChatAbility, type Message } from "@/chat/index";
import { initCodocUse } from "@/codoc-use/index";
import {
  registerPresetAgents,
  registerPresetAgentHandlers,
} from "@/agents/register";
import { getWorkspace } from "./_workspace";

type ChatListener = (msg: Message) => void;
type IntentListener = (
  msgId: string,
  intentIdx: number,
  status: "proposed" | "confirmed" | "rejected",
) => void;

const g = globalThis as typeof globalThis & {
  _chat?: ChatAbility;
  _sessionId?: string;
  _chatListeners?: Set<ChatListener>;
  _intentListeners?: Set<IntentListener>;
  _chatInitPromise?: Promise<void>;
};

if (!g._chatListeners) g._chatListeners = new Set();
if (!g._intentListeners) g._intentListeners = new Set();

async function initChat(): Promise<void> {
  if (g._chat && g._sessionId) return;

  const chat = createChatAbility();
  const sessionId = chat.createSession({ id: "main" });

  // Step 3: Codoc Use
  const workspace = await getWorkspace();
  initCodocUse(workspace, chat, sessionId);

  // Step 4: Agents
  registerPresetAgents(chat, sessionId);
  registerPresetAgentHandlers(chat, sessionId);

  // Subscribe to events for SSE broadcasting
  chat.on(sessionId, "onMessage", (msg) => {
    for (const fn of g._chatListeners!) fn(msg);
  });

  chat.on(sessionId, "onIntentStatusChange", (msgId, idx, status) => {
    for (const fn of g._intentListeners!) fn(msgId, idx, status);
  });

  g._chat = chat;
  g._sessionId = sessionId;
}

export async function getChatAbility(): Promise<ChatAbility> {
  if (!g._chatInitPromise) {
    g._chatInitPromise = initChat();
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
  return () => { g._chatListeners!.delete(fn); };
}

export function onIntentStatusChange(fn: IntentListener): () => void {
  g._intentListeners!.add(fn);
  return () => { g._intentListeners!.delete(fn); };
}
