"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ChatMessage, ChatParticipant } from "@/workspace/api-client";

type Listener = () => void;

export class ChatSessionStore {
  private messages: ChatMessage[] = [];
  private participants: ChatParticipant[] = [];
  private references: Array<{ kind: string; id: string; label?: string }> = [];
  private listeners = new Set<Listener>();

  // --- Hydration ---

  hydrate(data: {
    messages: ChatMessage[];
    participants: ChatParticipant[];
    resources: Array<{ kind: string; id: string; label?: string }>;
  }): void {
    this.messages = data.messages;
    this.participants = data.participants;
    this.references = data.resources;
    this.notify();
  }

  // --- SSE event handlers ---

  addMessage(msg: ChatMessage): void {
    // Dedup: don't add if already present (user message may come from POST + SSE)
    if (this.messages.some((m) => m.id === msg.id)) return;
    this.messages = [...this.messages, msg];
    this.notify();
  }

  updateIntentStatus(
    msgId: string,
    intentIdx: number,
    status: "proposed" | "confirmed" | "rejected",
  ): void {
    this.messages = this.messages.map((msg) => {
      if (msg.id !== msgId || !msg.intents) return msg;
      const intents = msg.intents.map((intent, i) =>
        i === intentIdx ? { ...intent, status } : intent,
      );
      return { ...msg, intents };
    });
    this.notify();
  }

  // --- Reference management (local tracking) ---

  addReference(ref: { kind: string; id: string; label?: string }): void {
    if (this.references.some((r) => r.id === ref.id)) return;
    this.references = [...this.references, ref];
    this.notify();
  }

  removeReference(refId: string): void {
    this.references = this.references.filter((r) => r.id !== refId);
    this.notify();
  }

  // --- Reads ---

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getParticipants(): ChatParticipant[] {
    return this.participants;
  }

  getReferences(): Array<{ kind: string; id: string; label?: string }> {
    return this.references;
  }

  // --- Subscriptions ---

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

// Singleton
let store: ChatSessionStore | undefined;

export function getChatStore(): ChatSessionStore {
  if (!store) store = new ChatSessionStore();
  return store;
}

// --- Hooks ---

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PARTICIPANTS: ChatParticipant[] = [];
const EMPTY_REFERENCES: Array<{ kind: string; id: string; label?: string }> = [];

export function useChatMessages(): ChatMessage[] {
  const s = getChatStore();
  const subscribe = useCallback((cb: () => void) => s.subscribe(cb), [s]);
  const getSnapshot = useCallback(() => s.getMessages(), [s]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MESSAGES);
}

export function useChatParticipants(): ChatParticipant[] {
  const s = getChatStore();
  const subscribe = useCallback((cb: () => void) => s.subscribe(cb), [s]);
  const getSnapshot = useCallback(() => s.getParticipants(), [s]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_PARTICIPANTS);
}

export function useChatReferences(): Array<{
  kind: string;
  id: string;
  label?: string;
}> {
  const s = getChatStore();
  const subscribe = useCallback((cb: () => void) => s.subscribe(cb), [s]);
  const getSnapshot = useCallback(() => s.getReferences(), [s]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_REFERENCES);
}
