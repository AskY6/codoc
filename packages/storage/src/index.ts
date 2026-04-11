// @cobook/storage — the storage port layer.
//
// This package defines interfaces only. It does NOT ship a concrete
// persistence implementation. A runtime target (in-memory, SQLite,
// Postgres, …) lives in its own package and implements the `Storage`
// interface exported from here.
//
// Service code depends exclusively on this package. It must not
// reach past the port to an implementation, and it must not smuggle
// storage-layer types (Rev, Timestamp, StoredX envelopes) into core.

// ---- base types --------------------------------------------------------
export type { Ctx } from "./ctx.js";
export type { Clock } from "./clock.js";
export type { Rev, Timestamp } from "./meta.js";

// ---- error ADTs --------------------------------------------------------
export type {
  AlreadyExists,
  CodocReferenced,
  Conflict,
  NotFound,
  ThreadCodocWorkspaceMismatch,
  TxAborted,
} from "./errors.js";

// ---- stored envelopes --------------------------------------------------
export type {
  StoredAgent,
  StoredAgentSession,
  StoredChatMessage,
  StoredChatThread,
  StoredCodoc,
  StoredThreadAgent,
  StoredThreadCodoc,
  StoredWorkspace,
  StoredWorkspaceAgent,
} from "./stored.js";

// ---- store ports -------------------------------------------------------
export type { AgentStore, UpdateAgentInput } from "./stores/agent.js";
export type {
  AgentSessionStore,
  UpdateSessionInput,
} from "./stores/session.js";
export type {
  CodocStore,
  CreateCodocInput,
  UpdateCodocInput,
} from "./stores/codoc.js";
export type { ThreadAgentStore } from "./stores/thread-agent.js";
export type { ThreadCodocStore } from "./stores/thread-codoc.js";
export type {
  ListMessagesOptions,
  ThreadStore,
  UpdateThreadInput,
} from "./stores/thread.js";
export type { WorkspaceAgentStore } from "./stores/workspace-agent.js";
export type {
  UpdateWorkspaceInput,
  WorkspaceStore,
} from "./stores/workspace.js";

// ---- storage facade ----------------------------------------------------
export type { Storage } from "./storage.js";
