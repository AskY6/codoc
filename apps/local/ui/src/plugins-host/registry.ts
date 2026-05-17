// Static registry of UI plugin modules.
//
// Plugins ship an `activateUi(ctx)` from their `ui/index.ts`. The host
// pulls them in here at compile time. Phase 6 (dynamic distribution)
// replaces this with manifest-driven dynamic imports.

import { activateUi as rssActivateUi } from "@plugins/rss/ui/index.ts";
import type { UiPluginModule } from "./types.ts";

export const uiPluginRegistry: Record<string, UiPluginModule> = {
  rss: { pluginId: "rss", activateUi: rssActivateUi },
};
