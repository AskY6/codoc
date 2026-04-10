// Public entry point for @cobook/storage.
//
// This package owns the physical storage layer: Drizzle client, schema, and
// repositories. Consumers (service / seed / migrate) import factories and
// repository types from here.

export { createDb } from "./db/client.js";
export type { Database, DbExecutor } from "./db/client.js";

export * from "./db/schema.js";

export { createWorkspaceRepository } from "./db/repositories/workspace-repository.js";
export { createCodocRepository } from "./db/repositories/codoc-repository.js";
export { createEdgeRepository } from "./db/repositories/edge-repository.js";
export { createChatRepository } from "./db/repositories/chat-repository.js";
export { createWorkspaceAgentRepository } from "./db/repositories/workspace-agent-repository.js";
export { createAgentSessionRepository } from "./db/repositories/agent-session-repository.js";
export { createResolvedFieldRepository } from "./db/repositories/resolved-field-repository.js";

export type {
  Workspace,
  WorkspaceListItem,
  Codoc,
  Edge,
  ChatThread,
  ChatMessage,
  ChatMessageMetadata,
  ThreadCodoc,
  ThreadAgent,
  WorkspaceAgent,
  AgentSession,
  ResolvedField,
  ResolvedFieldState,
  WorkspaceRepository,
  CodocRepository,
  EdgeRepository,
  ChatRepository,
  WorkspaceAgentRepository,
  AgentSessionRepository,
  ResolvedFieldRepository,
} from "./db/repositories/types.js";
