import type { WorkspaceId } from "./ids.js";

/**
 * A workspace — cobook's collaboration boundary. Groups codocs, threads
 * and agent sessions under a single tenancy.
 *
 * Core only owns the domain shape; persisted metadata (timestamps,
 * creator, etc.) lives in the storage layer.
 */
export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly description: string | null;
}
