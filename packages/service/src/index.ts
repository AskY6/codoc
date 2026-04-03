// DB
export {
  createDb,
  createWorkspaceRepository,
  createCodocRepository,
  createEdgeRepository,
  createChatRepository,
  createAgentSessionRepository,
} from "./db/index.js";

export type {
  Database,
  Workspace,
  Codoc,
  Edge,
  ChatThread,
  ChatMessage,
  ThreadCodoc,
  ThreadAgent,
  WorkspaceAgent,
  AgentSession,
  WorkspaceRepository,
  CodocRepository,
  EdgeRepository,
  ChatRepository,
  AgentSessionRepository,
} from "./db/index.js";

// Service
export { createWorkspaceService } from "./workspace-service.js";
export type { WorkspaceService, WorkspaceServiceDeps } from "./workspace-service.js";

// Source executor
export { executeSource } from "./source-executor.js";
export type { Source, StaticSource } from "./source-executor.js";

// Chat service
export { createChatService } from "./chat-service.js";
export type { ChatService, ChatServiceDeps } from "./chat-service.js";

// Types
export { SourceError } from "./types.js";
export type {
  BuildDiagnostics,
  DiagnosticError,
  WorkspaceStatus,
  CodocInfo,
} from "./types.js";
