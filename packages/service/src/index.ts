// @cobook/service — the use-case layer.
//
// Service is the first consumer of the storage port and the only
// layer allowed to orchestrate across storage, chat runtime, and
// graph runtime. Transport packages (HTTP / CLI / MCP) import from
// here and nothing deeper.
//
// Two subtrees, strictly inward-pointing:
//   repo/     — thin facades over @cobook/storage; no runtime, no tx
//   usecases/ — business actions; owns tx boundaries and runtime glue
//
// Plus two infrastructure subtrees:
//   ports/    — outbound ports the service needs (id gen, …)
//   types/    — UI-shaped DTOs returned by use cases
//
// Import direction inside this package:
//   usecases → repo → @cobook/storage
//   usecases → @cobook/chat / @cobook/graph
//   usecases → @cobook/storage (direct, when opening transactions)

// ---- context + errors -------------------------------------------------
export type { ServiceCtx } from "./context.js";
export { withStorageCtx } from "./context.js";

export type {
  ServiceError,
  WorkspaceNotFound,
  AgentNotFound,
  CodocNotFound,
  ThreadNotFound,
  MessageNotFound,
  SessionNotFound,
  WorkspaceAlreadyExists,
  AgentAlreadyExists,
  CodocAlreadyExists,
  ThreadAlreadyExists,
  WorkspaceConflict,
  AgentConflict,
  CodocConflict,
  ThreadConflict,
  SessionConflict,
  CodocReferenced,
  ThreadCodocWorkspaceMismatch,
  StorageUnavailable,
} from "./errors.js";

// ---- ports (outbound dependencies) ------------------------------------
export type { IdGenerator } from "./ports/id.js";

// ---- DTOs (UI-shaped use case return values) --------------------------
export type { WorkspaceListItem } from "./types/workspace.js";
export type { CodocDetail, CodocListItem } from "./types/codoc.js";

// ---- repo (thin facades over storage) ---------------------------------
export * from "./repo/index.js";

// ---- usecases (business actions) --------------------------------------
export * from "./usecases/index.js";
