// `WorkspaceListItem` — UI-shaped DTO returned by workspace use cases.
//
// The use case layer hands UIs an envelope that bundles the canonical
// `Workspace` core type with the small bit of metadata they actually
// need: `updatedAt` for "edited X minutes ago", `rev` as the
// optimistic-concurrency token callers pass back in `expectedRev` on
// update, and `codocCount` so the list card can show a badge without a
// second request. Storage's `Rev` and `Timestamp` brands stay inside
// the storage layer; the UI sees a raw number and an opaque string.
//
// `rev` is intentionally opaque — the UI must not parse or compare it
// beyond equality, and the only place it is ever produced is the repo
// layer peeling `StoredWorkspace.rev`. This keeps the
// optimistic-concurrency protocol symmetric: the client only ever
// echoes back what the server handed it.
//
// `codocCount` is server-computed in the repo layer as a pure-read
// cross-store join. The decision and its rationale are documented in
// `usecases/workspace/AGENTS.md`.
//
// `Workspace` itself stays canonical — the DTO nests it rather than
// flattening, so the wire shape and the in-memory shape match and the
// transport layer is a pure `JSON.stringify`.

import type { Workspace } from "@cobook/core";

export interface WorkspaceListItem {
  readonly workspace: Workspace;
  readonly updatedAt: number;
  readonly rev: string;
  readonly codocCount: number;
  readonly agentCount: number;
}
