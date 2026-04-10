import type { SessionId, ThreadId, WorkspaceId } from "./ids.js";

/**
 * Cross-turn private state held by an agent inside a workspace (and
 * optionally scoped to a single thread).
 *
 * `state` is an opaque record — its shape is agent-specific and lives
 * outside core's concern.
 */
export interface AgentSession {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly threadId: ThreadId | null;
  readonly activeSceneId: string | null;
  readonly state: Readonly<Record<string, unknown>>;
}
