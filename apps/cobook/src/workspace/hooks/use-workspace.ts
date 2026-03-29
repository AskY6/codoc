"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WorkspaceStore } from "@/workspace/workspace-store";
import { fetchWorkspace } from "@/workspace/api-client";
import type { FieldEvent } from "@/shared/types";

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

  es.addEventListener("field", (e) => {
    try {
      const event: FieldEvent = JSON.parse(e.data);
      store.applyFieldEvent(event);
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
    fetchWorkspace()
      .then((snapshot) => {
        store.hydrateWorkspace(snapshot);
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
