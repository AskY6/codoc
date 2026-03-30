import type {
  IntentRecord,
  IntentStatus,
  IntentFlags,
  IntentQueueEvent,
  EnqueueParams,
} from "./types.js";

export interface IntentQueueConfig {
  debounceMs: number;
  mergeEnabled: boolean;
  rateLimitMs: number;
}

const DEFAULT_CONFIG: IntentQueueConfig = {
  debounceMs: 300,
  mergeEnabled: true,
  rateLimitMs: 500,
};

type Listener = (event: IntentQueueEvent) => void;
type Unsubscribe = () => void;

let idCounter = 0;

/**
 * Intent Queue — the decoupling layer between scene agents and codoc agent.
 *
 * Scene agents enqueue NL intents; the consumer (codoc agent) picks up
 * confirmed intents and executes them. Supports debounce, merge, and
 * rate-limiting on the consumer side.
 */
export class IntentQueue {
  private records = new Map<string, IntentRecord>();
  private listeners = new Set<Listener>();
  private config: IntentQueueConfig;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastExecutionTime = 0;

  constructor(config?: Partial<IntentQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Enqueue a new intent. If `trusted` is set, the intent goes straight
   * to "confirmed" status, skipping human review.
   */
  enqueue(params: EnqueueParams): IntentRecord {
    const id = `intent_${Date.now()}_${++idCounter}`;
    const now = Date.now();

    // Merge: if there's already a pending intent for same target+field, replace it
    if (this.config.mergeEnabled) {
      const mergeKey = `${params.target.docId}:${params.target.field ?? "*"}`;
      for (const existing of this.records.values()) {
        if (
          existing.status === "pending" &&
          existing.source === params.source &&
          `${existing.target.docId}:${existing.target.field ?? "*"}` === mergeKey
        ) {
          // Supersede the old pending intent
          existing.status = "rejected";
          existing.updatedAt = now;
          this.emit({ type: "status-changed", id: existing.id, status: "rejected", prev: "pending" });
        }
      }
    }

    const record: IntentRecord = {
      id,
      source: params.source,
      target: params.target,
      content: params.content,
      payload: params.payload,
      status: params.trusted ? "confirmed" : "pending",
      flags: {},
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(id, record);
    this.emit({ type: "enqueued", record });
    return record;
  }

  /**
   * Transition an intent to a new status.
   * Validates that the transition is legal.
   */
  transition(id: string, status: IntentStatus): void {
    const record = this.records.get(id);
    if (!record) throw new Error(`Intent not found: ${id}`);

    const prev = record.status;
    if (!isValidTransition(prev, status)) {
      throw new Error(`Invalid intent transition: ${prev} → ${status}`);
    }

    record.status = status;
    record.updatedAt = Date.now();
    this.emit({ type: "status-changed", id, status, prev });
  }

  /** Mark an intent with conflict/stale flags */
  setFlags(id: string, flags: Partial<IntentFlags>): void {
    const record = this.records.get(id);
    if (!record) throw new Error(`Intent not found: ${id}`);

    record.flags = { ...record.flags, ...flags };
    record.updatedAt = Date.now();
    this.emit({ type: "flags-changed", id, flags: record.flags });
  }

  get(id: string): IntentRecord | undefined {
    return this.records.get(id);
  }

  getAll(): IntentRecord[] {
    return [...this.records.values()];
  }

  getByStatus(...statuses: IntentStatus[]): IntentRecord[] {
    const set = new Set(statuses);
    return [...this.records.values()].filter((r) => set.has(r.status));
  }

  getPendingCount(): number {
    let count = 0;
    for (const r of this.records.values()) {
      if (r.status === "pending" || r.status === "previewed") count++;
    }
    return count;
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Check if rate limit allows an execution right now */
  canExecute(): boolean {
    return Date.now() - this.lastExecutionTime >= this.config.rateLimitMs;
  }

  recordExecution(): void {
    this.lastExecutionTime = Date.now();
  }

  /**
   * Check all pending intents for conflict/stale conditions.
   * Call this when a field changes externally.
   */
  markConflicts(docId: string, field?: string): void {
    for (const record of this.records.values()) {
      if (
        (record.status === "pending" || record.status === "previewed") &&
        record.target.docId === docId &&
        (!field || !record.target.field || record.target.field === field)
      ) {
        this.setFlags(record.id, { conflicted: true });
      }
    }
  }

  /**
   * Mark stale intents — pending intents older than the given threshold.
   */
  markStale(thresholdMs: number): void {
    const now = Date.now();
    for (const record of this.records.values()) {
      if (
        (record.status === "pending" || record.status === "previewed") &&
        now - record.createdAt > thresholdMs
      ) {
        this.setFlags(record.id, { stale: true });
      }
    }
  }

  private emit(event: IntentQueueEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* listener errors don't break the queue */ }
    }
  }
}

const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  pending: ["previewed", "confirmed", "rejected"],
  previewed: ["confirmed", "rejected"],
  confirmed: ["executed", "failed"],
  rejected: [],
  executed: ["propagated"],
  propagated: [],
  failed: [],
};

function isValidTransition(from: IntentStatus, to: IntentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
