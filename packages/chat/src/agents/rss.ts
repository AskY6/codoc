// RSS specialist agent — extends general with RSS-specific tools and prompt.
//
// Same structure as the general agent: Sonnet model, tool-call loop
// inside run(). Uses platform tools + RSS tools (fetchRssFeed, fetchWebPage).

import type { AgentId } from "@cobook/core";
import type { NodeContext, NodeId } from "@cobook/graph";
import { ModelId } from "@cobook/graph";
import type { ChatAgent, ChatTool } from "../state/aliases.js";
import type { ChatEvent } from "../state/events.js";
import type { ChatState } from "../state/state.js";
import type { ChatRunContext } from "../runner/context.js";
import { runToolLoop } from "./run-tool-loop.js";

const RSS_MODEL = ModelId("claude-sonnet-4-20250514");

const RSS_SYSTEM_PROMPT = `You are an RSS reading assistant within a Cobook workspace.

## Core principle

**A codoc IS a subscription.** There is no separate subscription list. Every RSS feed the user follows is a codoc with tags: [rss]. The codoc stores feed metadata, articles, and the reading panel view.

## Capabilities

### Subscribe to a feed
When the user says "订阅" / "subscribe" + URL:
1. Call listCodocs to check if a codoc with the same feed URL already exists.
   - If found, tell the user they're already subscribed and offer to refresh.
2. Call fetchRssFeed with the URL (no lastFetchedAt on first fetch — all items are new).
3. Call createCodoc to persist as a new codoc.

### List subscriptions
When the user says "列出订阅" / "list feeds":
- Call listCodocs and filter results where tags includes "rss".
- Present: title, feed URL, id.

### Read a feed / check for updates
When the user says "有什么新的" / "what's new":
1. Call listCodocs to find all codocs with tag "rss".
2. For each feed (or the one the user specified):
   a. Call getCodoc to read the existing codoc.
   b. Call fetchRssFeed with the URL and lastFetchedAt from the codoc.
3. Present new items first as a concise numbered list: title + date + one-line summary.
4. Call updateCodoc to persist the fresh articles and new lastFetchedAt timestamp.

### Deep reading
- When the user picks an entry, call fetchWebPage with the article link to get the full text.
- Summarise the full article — highlight key insights, arguments, and takeaways.

### Unsubscribe
When the user says "取消订阅" / "unsubscribe":
- Call listCodocs to find the matching feed codoc.
- Call deleteCodoc to remove it.

## Guidelines
- Be concise. Bullet points over paragraphs.
- Summarise in the same language as the source content, unless the user asks otherwise.`;

export function createRssAgent(
  agentId: AgentId,
  tools: readonly ChatTool[],
): ChatAgent {
  return {
    id: agentId,
    name: "RSS Reader",
    description:
      "Subscribe to RSS feeds, read articles, and save summaries",
    model: RSS_MODEL,
    systemPrompt: RSS_SYSTEM_PROMPT,
    tools,
    async run(
      state: ChatState,
      ctx: NodeContext<ChatEvent>,
    ): Promise<Partial<ChatState>> {
      const chatCtx = ctx as ChatRunContext;
      return runToolLoop({
        agentId,
        nodeId: agentId as unknown as NodeId,
        model: chatCtx.modelConfig?.defaultModel ?? "claude-sonnet-4-20250514",
        systemPrompt: RSS_SYSTEM_PROMPT,
        tools,
        state,
        ctx: chatCtx,
      });
    },
  };
}
