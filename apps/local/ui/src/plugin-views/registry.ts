// Plugin view registry — static map from (pluginId, viewId) to React component.
//
// Each plugin's secondary views (declared in uiSpec.secondaryViews) are rendered
// in App.tsx via this registry. Plugins register components by editing this file
// (server-side plugin code can't reach into the browser bundle).

import type { ComponentType } from "react";
import { SubscriptionsPanel, SavedArticlesPanel } from "@plugins/rss/ui/index.ts";

export interface PluginViewProps {
  onSelectCodoc: (path: string) => void;
}

export const pluginViewRegistry: Record<
  string,
  Record<string, ComponentType<PluginViewProps>>
> = {
  rss: {
    "rss-subscriptions": SubscriptionsPanel,
    "rss-saved": SavedArticlesPanel,
  },
};
