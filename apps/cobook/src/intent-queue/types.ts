// Intent Queue — core type definitions.
// The decoupling layer between scene agents (producers) and codoc agent (consumer).

export type IntentStatus =
  | "pending"
  | "previewed"
  | "confirmed"
  | "rejected"
  | "executed"
  | "propagated"
  | "failed";

export interface IntentFlags {
  conflicted?: boolean;
  stale?: boolean;
}

export interface IntentRecord {
  id: string;
  /** Which agent produced this intent */
  source: string;
  /** Target codoc and optional field */
  target: {
    docId: string;
    field?: string;
  };
  /** Natural language description of the operation */
  content: string;
  /** Structured payload for backward-compat with legacy intent kinds */
  payload?: { kind: string; payload: unknown };
  status: IntentStatus;
  flags: IntentFlags;
  createdAt: number;
  updatedAt: number;
}

export type IntentQueueEvent =
  | { type: "enqueued"; record: IntentRecord }
  | { type: "status-changed"; id: string; status: IntentStatus; prev: IntentStatus }
  | { type: "flags-changed"; id: string; flags: IntentFlags };

export interface EnqueueParams {
  source: string;
  target: { docId: string; field?: string };
  content: string;
  payload?: { kind: string; payload: unknown };
  /** If true, skip pending/previewed and go straight to confirmed (trusted agent) */
  trusted?: boolean;
}
