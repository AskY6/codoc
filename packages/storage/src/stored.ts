// StoredX — envelopes that add storage-layer metadata (rev, timestamps,
// ownership) around the pure core domain values.
//
// Services receive `StoredX` and extract `.codoc` / `.workspace` / ...
// when they need to call into core. Storage metadata stays on the
// envelope and never bleeds into core types, preserving the invariant
// that core holds no timestamps, revs, or tenancy fields.

import type {
  AgentListing,
  AgentSession,
  ChatMessage,
  ChatThread,
  Codoc,
  ThreadAgent,
  ThreadCodoc,
  Workspace,
  WorkspaceAgent,
  WorkspaceId,
} from "@cobook/core";
import type { Rev, Timestamp } from "./meta.js";

/**
 * A persisted codoc. `workspaceId` lives on the envelope — not on the
 * core `Codoc` type — because `core/codoc` is forbidden from referring
 * to cobook-level concepts like workspaces.
 */
export interface StoredCodoc {
  readonly codoc: Codoc;
  readonly workspaceId: WorkspaceId;
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface StoredWorkspace {
  readonly workspace: Workspace;
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface StoredAgent {
  readonly listing: AgentListing;
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface StoredChatThread {
  readonly thread: ChatThread;
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * A persisted chat message. `seq` is a thread-local monotonic integer
 * assigned atomically at append time, so services never need to
 * coordinate their own counters. Combined with a sortable `MessageId`
 * (ULID / UUIDv7) it gives callers both a deterministic total order
 * and a stable anchor for pagination.
 */
export interface StoredChatMessage {
  readonly message: ChatMessage;
  readonly seq: number;
  readonly createdAt: Timestamp;
}

export interface StoredAgentSession {
  readonly session: AgentSession;
  readonly rev: Rev;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

// ---- join tables ---------------------------------------------------
//
// Joins are set-semantics links, not entities. They carry `createdAt`
// for audit, but no `rev`: they are only ever inserted or deleted.

export interface StoredWorkspaceAgent {
  readonly link: WorkspaceAgent;
  readonly createdAt: Timestamp;
}

export interface StoredThreadCodoc {
  readonly link: ThreadCodoc;
  readonly createdAt: Timestamp;
}

export interface StoredThreadAgent {
  readonly link: ThreadAgent;
  readonly createdAt: Timestamp;
}
