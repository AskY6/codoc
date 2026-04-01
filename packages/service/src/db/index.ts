export { createDb } from "./client.js";
export type { Database } from "./client.js";

export * from "./schema.js";

export { createWorkspaceRepository } from "./repositories/workspace-repository.js";
export { createCodocRepository } from "./repositories/codoc-repository.js";
export { createEdgeRepository } from "./repositories/edge-repository.js";
export { createChatRepository } from "./repositories/chat-repository.js";
export { createAgentSessionRepository } from "./repositories/agent-session-repository.js";

export type {
  Workspace,
  Codoc,
  Edge,
  ChatThread,
  ChatMessage,
  AgentSession,
  WorkspaceRepository,
  CodocRepository,
  EdgeRepository,
  ChatRepository,
  AgentSessionRepository,
} from "./repositories/types.js";
