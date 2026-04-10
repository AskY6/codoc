import type { CodocId } from "../codoc/ids.js";
import type { AgentId, ThreadId, WorkspaceId } from "./ids.js";

// Join / membership records.
//
// Each of these is a value object identified by its composite key — no
// surrogate `id`, no timestamps. Storage backends that want surrogate
// keys or audit columns add them in their own persisted projections.

/** An agent enabled in a workspace. */
export interface WorkspaceAgent {
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
}

/** A codoc pinned into a thread's active context. */
export interface ThreadCodoc {
  readonly threadId: ThreadId;
  readonly codocId: CodocId;
}

/** An agent activated in a specific thread. */
export interface ThreadAgent {
  readonly threadId: ThreadId;
  readonly agentId: AgentId;
}
