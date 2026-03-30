import type {
  WorkspaceSnapshot,
  DocSnapshot,
  FieldSnapshot,
  FieldEvent,
  DocMeta,
  FieldAddress,
  DepEdge,
} from "@/shared/types";
import type { ConnectorStatus } from "./api-client";

type Listener = () => void;

export class WorkspaceStore {
  private docs: DocMeta[] = [];
  private graph: { nodes: FieldAddress[]; edges: DepEdge[] } = { nodes: [], edges: [] };
  private docFields = new Map<string, Record<string, FieldSnapshot>>();
  private docViews = new Map<string, string>();
  private listeners = new Set<Listener>();
  private fieldListeners = new Map<string, Set<Listener>>();
  private connectorStatuses: ConnectorStatus[] = [];
  private feedEvents: FieldEvent[] = [];
  private feedListeners = new Set<Listener>();

  // --- Hydration ---

  hydrateWorkspace(snapshot: WorkspaceSnapshot): void {
    this.docs = snapshot.docs;
    this.graph = snapshot.graph;
    this.notifyAll();
  }

  hydrateDoc(snapshot: DocSnapshot): void {
    this.docFields.set(snapshot.docId, snapshot.fields);
    this.docViews.set(snapshot.docId, snapshot.view);
    this.notifyAll();
    for (const path of Object.keys(snapshot.fields)) {
      this.notifyField(snapshot.docId, path);
    }
  }

  // --- SSE events ---

  applyFieldEvent(event: FieldEvent): void {
    // New array reference so useSyncExternalStore detects the change
    this.feedEvents = [...this.feedEvents, event];
    if (this.feedEvents.length > 200) {
      this.feedEvents = this.feedEvents.slice(-100);
    }
    for (const fn of this.feedListeners) fn();

    const fields = this.docFields.get(event.docId);
    if (!fields) return;

    const existing = fields[event.path];
    if (!existing) return;

    fields[event.path] = {
      ...existing,
      status: event.status as FieldSnapshot["status"],
      value: event.value ?? existing.value,
      error: event.error ?? existing.error,
    };

    this.notifyField(event.docId, event.path);
    this.notifyAll();
  }

  // --- Reads ---

  getDocs(): DocMeta[] {
    return this.docs;
  }

  getGraph(): { nodes: FieldAddress[]; edges: DepEdge[] } {
    return this.graph;
  }

  getDocFields(docId: string): Record<string, FieldSnapshot> | undefined {
    return this.docFields.get(docId);
  }

  getDocView(docId: string): string | undefined {
    return this.docViews.get(docId);
  }

  getFieldSnapshot(docId: string, path: string): FieldSnapshot | undefined {
    return this.docFields.get(docId)?.[path];
  }

  getConnectorStatuses(): ConnectorStatus[] {
    return this.connectorStatuses;
  }

  hydrateConnectors(statuses: ConnectorStatus[]): void {
    this.connectorStatuses = statuses;
    this.notifyAll();
  }

  getFeedEvents(): FieldEvent[] {
    return this.feedEvents;
  }

  // --- Subscriptions ---

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeField(docId: string, path: string, listener: Listener): () => void {
    const key = `${docId}:${path}`;
    let set = this.fieldListeners.get(key);
    if (!set) {
      set = new Set();
      this.fieldListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.fieldListeners.delete(key);
    };
  }

  subscribeFeed(listener: Listener): () => void {
    this.feedListeners.add(listener);
    return () => { this.feedListeners.delete(listener); };
  }

  // --- Internal ---

  private notifyAll(): void {
    for (const fn of this.listeners) fn();
  }

  private notifyField(docId: string, path: string): void {
    const key = `${docId}:${path}`;
    const set = this.fieldListeners.get(key);
    if (set) {
      for (const fn of set) fn();
    }
  }
}
