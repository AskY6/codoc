import type { Brand } from "../shared/branded.js";

// Identifiers for the cobook layer (workspaces, agents, chat threads,
// messages, agent sessions). All are branded strings; the runtime is
// still `string`, but TypeScript refuses to mix them.

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type AgentId = Brand<string, "AgentId">;
export type ThreadId = Brand<string, "ThreadId">;
export type MessageId = Brand<string, "MessageId">;
export type SessionId = Brand<string, "SessionId">;

export const WorkspaceId = (s: string): WorkspaceId => s as WorkspaceId;
export const AgentId = (s: string): AgentId => s as AgentId;
export const ThreadId = (s: string): ThreadId => s as ThreadId;
export const MessageId = (s: string): MessageId => s as MessageId;
export const SessionId = (s: string): SessionId => s as SessionId;
