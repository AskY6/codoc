// `WorkspaceListItem` — UI-shaped DTO returned by workspace list use cases.
//
// The use case layer hands UIs an envelope that bundles the canonical
// `Workspace` core type with the small bit of metadata they actually
// need: `updatedAt` for "edited X minutes ago" and `rev` as the
// optimistic-concurrency token callers pass back in `expectedRev` on
// update. Storage's `Rev` and `Timestamp` brands stay inside the
// storage layer; the UI sees a raw number and an opaque string.
//
// `rev` is intentionally opaque — the UI must not parse or compare it
// beyond equality, and the only place it is ever produced is the repo
// layer peeling `StoredWorkspace.rev`. This keeps the
// optimistic-concurrency protocol symmetric: the client only ever
// echoes back what the server handed it.
//
// `Workspace` itself stays canonical — the DTO nests it rather than
// flattening, so the wire shape and the in-memory shape match and the
// transport layer is a pure `JSON.stringify`.

import type { Workspace } from "@cobook/core";

export interface WorkspaceListItem {
  readonly workspace: Workspace;
  readonly updatedAt: number;
  readonly rev: string;
}
