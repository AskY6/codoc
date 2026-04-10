// Cobook domain — the collaboration boundary layer: workspaces, agents,
// chat, and the join records that tie them to codocs.
//
// Imports from codoc/ are limited to ID types; cobook never reads codoc
// internals.

export {
  WorkspaceId,
  AgentId,
  ThreadId,
  MessageId,
  SessionId,
} from "./ids.js";

export type { Workspace } from "./workspace.js";
export type { Agent } from "./agent.js";

export type {
  ChatThread,
  ChatMessage,
  ToolCall,
  AssistantMetadata,
} from "./chat.js";

export type {
  WorkspaceAgent,
  ThreadCodoc,
  ThreadAgent,
} from "./membership.js";

export type { AgentSession } from "./session.js";
