// RSS plugin — UI bundle entry.
//
// Phase 4: `activateUi(ctx)` registers MDX components shipped with the
// plugin so they don't have to be scaffolded into the user's workspace.
// Phase 3: registers UI-only commands (e.g. `rss.subscribe` opens a chat
// prompt).
//
// The plugin-view registry still imports the panel components directly
// (those mount in the SPA shell via secondaryViews).

import type { ComponentType } from "react";
import type { UiActivateContext } from "@/plugins-host/types.ts";
import { ArticleList } from "../components/ArticleList.tsx";
import { DigestList } from "../components/DigestList.tsx";
import { DigestStats } from "../components/DigestStats.tsx";
import { DigestTop } from "../components/DigestTop.tsx";
import { DigestTrending } from "../components/DigestTrending.tsx";
import { FeedHeader } from "../components/FeedHeader.tsx";
import { SourceBadge } from "../components/SourceBadge.tsx";

export { SubscriptionsPanel } from "./panels/SubscriptionsPanel.tsx";
export { SavedArticlesPanel } from "./panels/SavedArticlesPanel.tsx";

const componentMap: Record<string, ComponentType<Record<string, unknown>>> = {
  ArticleList: ArticleList as ComponentType<Record<string, unknown>>,
  DigestList: DigestList as ComponentType<Record<string, unknown>>,
  DigestStats: DigestStats as ComponentType<Record<string, unknown>>,
  DigestTop: DigestTop as ComponentType<Record<string, unknown>>,
  DigestTrending: DigestTrending as ComponentType<Record<string, unknown>>,
  FeedHeader: FeedHeader as ComponentType<Record<string, unknown>>,
  SourceBadge: SourceBadge as ComponentType<Record<string, unknown>>,
};

export function activateUi(ctx: UiActivateContext): void {
  for (const [name, component] of Object.entries(componentMap)) {
    ctx.mdxComponents.register(name, component);
  }

  ctx.commands.registerCommand("rss.subscribe", () => {
    ctx.chat.openPrompt("Subscribe to ");
  });
}
