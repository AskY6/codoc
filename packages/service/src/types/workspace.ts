// `WorkspaceListItem` — UI-shaped DTO returned by workspace list use cases.
//
// The use case layer hands UIs an envelope that bundles the canonical
// `Workspace` core type with the small bit of metadata they actually
// need (`updatedAt` for "edited X minutes ago"). Storage's `Rev` and
// `Timestamp` brands stay inside the storage layer; the UI sees a raw
// number.
//
// `Workspace` itself stays canonical — the DTO nests it rather than
// flattening, so the wire shape and the in-memory shape match and the
// transport layer is a pure `JSON.stringify`.

import type { Workspace } from "@cobook/core";

export interface WorkspaceListItem {
  readonly workspace: Workspace;
  readonly updatedAt: number;
}
