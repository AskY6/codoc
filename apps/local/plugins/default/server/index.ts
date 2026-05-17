// Default plugin — fallback for workspaces without a specific workspaceKind.
//
// Provides no domain-specific runtime. activate() is a no-op; the host
// treats any workspace not claimed by another plugin as belonging here.

import type { ActivateContext } from "../../../src/plugins-host/context.js";

export function activate(_ctx: ActivateContext<unknown>): void {
  // intentional no-op
}
