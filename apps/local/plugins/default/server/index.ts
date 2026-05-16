// Default plugin — fallback for workspaces without a specific workspaceKind.
//
// Provides no domain-specific runtime. parseConfig accepts anything and
// returns an empty typed config, making "no plugin config" an explicit state.

import { ok } from "@cobook/core";
import type { WorkspacePlugin } from "../../../src/plugins/types.js";

export type DefaultPluginConfig = Record<string, never>;

export const defaultPlugin: WorkspacePlugin<DefaultPluginConfig> = {
  id: "default",
  name: "Default",
  description: "Generic workspace with no domain-specific runtime.",

  parseConfig() {
    return ok({} as DefaultPluginConfig);
  },
};
