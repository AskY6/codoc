"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WorkspaceStore } from "@/workspace/stores/workspace-store";
import { fetchWorkspace, fetchChatState, fetchConnectorStatuses } from "@/workspace/stores/api-client";
import type { ConnectorStatus } from "@/workspace/stores/api-client";
import { getChatStore } from "./use-session";
import type { FieldEvent } from "@/shared/types";
import type { ChatMessage } from "@/workspace/stores/api-client";

// Singleton store
const store = new WorkspaceStore();

export function getStore(): WorkspaceStore {
  return store;
}

// --- SSE connection ---

let sseStarted = false;

function startSSE(): void {
  if (sseStarted) return;
  sseStarted = true;

  const es = new EventSource("/api/events");
  const chatStore = getChatStore();

  es.addEventListener("field", (e) => {
    try {
      const event: FieldEvent = JSON.parse(e.data);
      store.applyFieldEvent(event);
    } catch { /* ignore malformed */ }
  });

  es.addEventListener("chat-message", (e) => {
    try {
      const msg: ChatMessage = JSON.parse(e.data);
      chatStore.addMessage(msg);
    } catch { /* ignore malformed */ }
  });

  es.addEventListener("chat-typing", (e) => {
    try {
      const { agentId, isTyping } = JSON.parse(e.data);
      chatStore.setTyping(agentId, isTyping);
    } catch { /* ignore malformed */ }
  });

  es.addEventListener("connector-status", (e) => {
    try {
      const statuses: ConnectorStatus[] = JSON.parse(e.data);
      store.hydrateConnectors(statuses);
    } catch { /* ignore malformed */ }
  });

  es.addEventListener("chat-intent", (e) => {
    try {
      const { msgId, intentIdx, status } = JSON.parse(e.data);
      chatStore.updateIntentStatus(msgId, intentIdx, status);

      // When a doc-mutating intent is confirmed, refresh workspace docs list
      if (status === "confirmed") {
        const msg = chatStore.getMessages().find((m) => m.id === msgId);
        const intent = msg?.intents?.[intentIdx];
        if (
          intent &&
          (intent.kind === "create-codoc" || intent.kind === "rewrite-codoc")
        ) {
          fetchWorkspace().then((ws) => store.hydrateWorkspace(ws));
        }
      }
    } catch { /* ignore malformed */ }
  });

  es.onerror = () => {
    es.close();
    sseStarted = false;
    // Reconnect after 2s
    setTimeout(startSSE, 2000);
  };
}

// --- Hook: initialize workspace ---

export function useWorkspaceInit(): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchWorkspace(), fetchChatState(), fetchConnectorStatuses()])
      .then(([wsSnapshot, chatState, connectors]) => {
        store.hydrateWorkspace(wsSnapshot);
        getChatStore().hydrate(chatState);
        store.hydrateConnectors(connectors);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });

    startSSE();
  }, []);

  return { loading, error };
}

// --- Hook: read workspace data ---

const EMPTY_DOCS: ReturnType<WorkspaceStore["getDocs"]> = [];
const EMPTY_GRAPH: ReturnType<WorkspaceStore["getGraph"]> = { nodes: [], edges: [] };
const EMPTY_CONNECTORS: ConnectorStatus[] = [];

export function useWorkspaceDocs() {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getDocs(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_DOCS);
}

export function useWorkspaceGraph() {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getGraph(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_GRAPH);
}

export function useConnectorStatuses() {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const getSnapshot = useCallback(() => store.getConnectorStatuses(), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONNECTORS);
}
