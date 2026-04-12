// Service-level error ADT.
//
// Use cases and repo modules return `Result<T, ServiceError>` — never
// raw storage errors. The repo layer is responsible for mapping storage
// variants into the equivalent service variants below, so that callers
// (HTTP handlers, CLI, MCP) can pattern-match on a single, stable shape
// without needing to know which storage adapter is underneath.
//
// The naming mirrors the aggregate the error describes. Keep variants
// narrow: a generic "service-error" bucket defeats the point of ADTs.

import type {
  AgentId,
  CodocId,
  MessageId,
  SessionId,
  ThreadId,
  WorkspaceId,
} from "@cobook/core";

// ---- not-found ---------------------------------------------------------

export type WorkspaceNotFound = {
  readonly kind: "workspace-not-found";
  readonly id: WorkspaceId;
};

export type AgentNotFound = {
  readonly kind: "agent-not-found";
  readonly id: AgentId;
};

export type CodocNotFound = {
  readonly kind: "codoc-not-found";
  readonly id: CodocId;
};

export type ThreadNotFound = {
  readonly kind: "thread-not-found";
  readonly id: ThreadId;
};

export type MessageNotFound = {
  readonly kind: "message-not-found";
  readonly id: MessageId;
};

export type SessionNotFound = {
  readonly kind: "session-not-found";
  readonly id: SessionId;
};

// ---- already-exists ----------------------------------------------------

export type WorkspaceAlreadyExists = {
  readonly kind: "workspace-already-exists";
  readonly id: WorkspaceId;
};

export type AgentAlreadyExists = {
  readonly kind: "agent-already-exists";
  readonly id: AgentId;
};

export type CodocAlreadyExists = {
  readonly kind: "codoc-already-exists";
  readonly id: CodocId;
};

export type ThreadAlreadyExists = {
  readonly kind: "thread-already-exists";
  readonly id: ThreadId;
};

export type MessageAlreadyExists = {
  readonly kind: "message-already-exists";
  readonly id: MessageId;
};

// ---- conflicts ---------------------------------------------------------
//
// Optimistic-concurrency failure. `expectedRev` is opaque to callers —
// they should refetch the aggregate and retry if they want to merge.

export type WorkspaceConflict = {
  readonly kind: "workspace-conflict";
};

export type AgentConflict = {
  readonly kind: "agent-conflict";
};

export type CodocConflict = {
  readonly kind: "codoc-conflict";
};

export type ThreadConflict = {
  readonly kind: "thread-conflict";
};

export type SessionConflict = {
  readonly kind: "session-conflict";
};

// ---- structural refusals ----------------------------------------------

/**
 * Codoc delete refused because at least one thread still references it.
 * Callers must unlink from the listed threads first.
 */
export type CodocReferenced = {
  readonly kind: "codoc-referenced";
  readonly byThreads: readonly ThreadId[];
};

/**
 * A thread ↔ codoc link was refused because the two belong to
 * different workspaces. Cross-workspace linking is not allowed.
 */
export type ThreadCodocWorkspaceMismatch = {
  readonly kind: "thread-codoc-workspace-mismatch";
  readonly threadWorkspaceId: WorkspaceId;
  readonly codocWorkspaceId: WorkspaceId;
};

// ---- parse failures -----------------------------------------------------

/**
 * The codoc content could not be parsed into a valid AST. Surfaced as
 * a 400 by transports. `message` describes the parse failure.
 */
export type CodocParseFailure = {
  readonly kind: "codoc-parse-failure";
  readonly message: string;
};

// ---- infrastructure ----------------------------------------------------

/**
 * The underlying storage transaction could not commit. Surfaced to the
 * caller verbatim; use cases should not retry automatically.
 */
export type StorageUnavailable = {
  readonly kind: "storage-unavailable";
  readonly cause: unknown;
};

// ---- union -------------------------------------------------------------

export type ServiceError =
  | WorkspaceNotFound
  | AgentNotFound
  | CodocNotFound
  | ThreadNotFound
  | MessageNotFound
  | SessionNotFound
  | WorkspaceAlreadyExists
  | AgentAlreadyExists
  | CodocAlreadyExists
  | ThreadAlreadyExists
  | MessageAlreadyExists
  | WorkspaceConflict
  | AgentConflict
  | CodocConflict
  | ThreadConflict
  | SessionConflict
  | CodocReferenced
  | CodocParseFailure
  | ThreadCodocWorkspaceMismatch
  | StorageUnavailable;
