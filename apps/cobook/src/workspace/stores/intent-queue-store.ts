import type { IntentStatus, IntentFlags } from "@/intent-queue/types";

/** Client-side representation of an intent record */
export interface IntentRecordView {
  id: string;
  source: string;
  target: { docId: string; field?: string };
  content: string;
  status: IntentStatus;
  flags: IntentFlags;
  createdAt: number;
  updatedAt: number;
}

/** Client-side representation of a scene agent */
export interface SceneAgentView {
  id: string;
  name: string;
  description: string;
  active: boolean;
  trusted: boolean;
}

type Listener = () => void;

export class IntentQueueStore {
  private records: IntentRecordView[] = [];
  private sceneAgents: SceneAgentView[] = [];
  private listeners = new Set<Listener>();

  // --- Intent Records ---

  hydrateIntents(records: IntentRecordView[]): void {
    this.records = records;
    this.notify();
  }

  addIntent(record: IntentRecordView): void {
    if (this.records.some((r) => r.id === record.id)) return;
    this.records = [...this.records, record];
    this.notify();
  }

  updateIntentStatus(id: string, status: IntentStatus): void {
    this.records = this.records.map((r) =>
      r.id === id ? { ...r, status, updatedAt: Date.now() } : r,
    );
    this.notify();
  }

  updateIntentFlags(id: string, flags: IntentFlags): void {
    this.records = this.records.map((r) =>
      r.id === id ? { ...r, flags: { ...r.flags, ...flags }, updatedAt: Date.now() } : r,
    );
    this.notify();
  }

  getRecords(): IntentRecordView[] {
    return this.records;
  }

  getPendingCount(): number {
    return this.records.filter(
      (r) => r.status === "pending" || r.status === "previewed",
    ).length;
  }

  // --- Scene Agents ---

  hydrateSceneAgents(agents: SceneAgentView[]): void {
    this.sceneAgents = agents;
    this.notify();
  }

  updateSceneAgent(id: string, update: Partial<SceneAgentView>): void {
    this.sceneAgents = this.sceneAgents.map((a) =>
      a.id === id ? { ...a, ...update } : a,
    );
    this.notify();
  }

  getSceneAgents(): SceneAgentView[] {
    return this.sceneAgents;
  }

  // --- Subscriptions ---

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
