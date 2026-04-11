// `IdGenerator` — port for minting opaque branded ids inside use cases.
//
// Use cases must NOT call `crypto.randomUUID()` directly: that would
// pin the service layer to a specific runtime and break the
// service ↔ runtime separation. Instead, every `ServiceCtx` carries
// an `IdGenerator`, and use cases call e.g. `ctx.idGen.workspaceId()`.
//
// The composition root in `apps/server` provides a `crypto.randomUUID`
// implementation; tests provide a deterministic counter.
//
// New id types are added one method at a time, as each vertical slice
// needs them.

import type { CodocId, WorkspaceId } from "@cobook/core";

export interface IdGenerator {
  workspaceId(): WorkspaceId;
  codocId(): CodocId;
}
