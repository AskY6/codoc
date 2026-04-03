import type Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { createBaseAgent } from "./base-agent.js";
import { toolDefinitions, executeTool } from "./tools.js";
import type { Agent, AgentContext, LLMConfig } from "./types.js";

// ---------------------------------------------------------------------------
// RSS domain state — stored in agent_sessions.state, never exposed to platform
// ---------------------------------------------------------------------------

interface RssFeed {
  url: string;
  title: string;
  alias?: string | undefined;
  addedAt: string;
  lastSeenAt?: string | undefined;
}

interface RssState {
  feeds: RssFeed[];
}

function getRssState(state: Record<string, unknown>): RssState {
  const rss = state["rss"] as RssState | undefined;
  return rss ?? { feeds: [] };
}

// ---------------------------------------------------------------------------
// RSS tool definitions (self-contained, not exported to platform)
// ---------------------------------------------------------------------------

const rssToolDefinitions: Anthropic.Tool[] = [
  {
    name: "fetchRssFeed",
    description:
      "Fetch and parse an RSS or Atom feed URL. Returns the feed title and a list of recent entries with title, link, published date, and summary/content.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The RSS or Atom feed URL to fetch",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "manageRssFeeds",
    description:
      "Manage the user's RSS feed subscriptions. Supports add, remove, and list actions. Subscriptions persist across sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "remove", "list"],
          description: "The action to perform",
        },
        url: {
          type: "string",
          description: "Feed URL (required for add/remove)",
        },
        alias: {
          type: "string",
          description: "Short alias for the feed (optional, for add)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "fetchWebPage",
    description:
      "Fetch the full content of a web page given its URL. Returns cleaned text (scripts/styles removed) for LLM summarisation. Use this after the user selects an RSS entry to get the full article.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The web page URL to fetch",
        },
      },
      required: ["url"],
    },
  },
];

// ---------------------------------------------------------------------------
// RSS tool executor
// ---------------------------------------------------------------------------

const rssParser = new Parser();

const MAX_PAGE_CHARS = 50_000;

function stripHtmlBoilerplate(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function executeRssTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<unknown> {
  if (name === "fetchRssFeed") {
    const url = String(input["url"]);
    const feed = await rssParser.parseURL(url);

    // Determine lastSeenAt watermark from saved state
    let lastSeenAt: string | undefined;
    if (ctx.sessionRepo) {
      const session = await ctx.sessionRepo.findByWorkspace(ctx.workspaceId);
      if (session) {
        const rss = getRssState(session.state);
        const saved = rss.feeds.find((f) => f.url === url);
        lastSeenAt = saved?.lastSeenAt;
      }
    }

    const items = feed.items.map((item) => {
      const pubDate = item.pubDate ?? item.isoDate;
      const isNew = !lastSeenAt || !pubDate ? true : new Date(pubDate) > new Date(lastSeenAt);
      return {
        title: item.title,
        link: item.link,
        pubDate,
        summary: item.contentSnippet ?? item.content,
        isNew,
      };
    });

    // Update lastSeenAt watermark
    if (ctx.sessionRepo) {
      const session = await ctx.sessionRepo.findByWorkspace(ctx.workspaceId);
      const state = session?.state ?? {};
      const rss = getRssState(state);
      const idx = rss.feeds.findIndex((f) => f.url === url);
      if (idx >= 0) {
        rss.feeds[idx]!.lastSeenAt = new Date().toISOString();
        await ctx.sessionRepo.upsert(ctx.workspaceId, null, { state: { ...state, rss } });
      }
    }

    const newCount = items.filter((i) => i.isNew).length;
    const seenCount = items.length - newCount;

    return {
      title: feed.title,
      description: feed.description,
      link: feed.link,
      items,
      newCount,
      seenCount,
    };
  }

  if (name === "manageRssFeeds") {
    if (!ctx.sessionRepo) return { error: "Session storage not available" };
    const action = String(input["action"]);
    const session = await ctx.sessionRepo.findByWorkspace(ctx.workspaceId);
    const state = session?.state ?? {};
    const rss = getRssState(state);

    if (action === "list") {
      return { feeds: rss.feeds };
    }

    if (action === "add") {
      const url = String(input["url"]);
      if (rss.feeds.some((f) => f.url === url)) {
        return { error: "Feed already subscribed", url };
      }
      // Fetch feed title for display
      let title = url;
      try {
        const feed = await rssParser.parseURL(url);
        title = feed.title ?? url;
      } catch { /* use URL as fallback title */ }
      const alias = input["alias"] ? String(input["alias"]) : undefined;
      rss.feeds.push({ url, title, alias, addedAt: new Date().toISOString() });
      await ctx.sessionRepo.upsert(ctx.workspaceId, null, { state: { ...state, rss } });
      return { ok: true, feed: rss.feeds[rss.feeds.length - 1] };
    }

    if (action === "remove") {
      const url = String(input["url"]);
      const before = rss.feeds.length;
      rss.feeds = rss.feeds.filter((f) => f.url !== url && f.alias !== url);
      if (rss.feeds.length === before) {
        return { error: "Feed not found", url };
      }
      await ctx.sessionRepo.upsert(ctx.workspaceId, null, { state: { ...state, rss } });
      return { ok: true, remaining: rss.feeds.length };
    }

    return { error: `Unknown action: ${action}` };
  }

  if (name === "fetchWebPage") {
    const url = String(input["url"]);
    const res = await fetch(url, {
      headers: { "User-Agent": "Cobook-RSS/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status} ${res.statusText}`, url };
    }
    const html = await res.text();
    const content = stripHtmlBoilerplate(html).slice(0, MAX_PAGE_CHARS);
    return { url, content };
  }

  // Fall through to platform codoc tools
  return executeTool(name, input, ctx);
}

// ---------------------------------------------------------------------------
// RSS agent — reads RSS feeds, summarises entries, saves to codoc
// ---------------------------------------------------------------------------

const CODOC_TOOLS = toolDefinitions.filter((t) =>
  t.name === "createCodoc" || t.name === "updateCodoc",
);

const RSS_SYSTEM_PROMPT = `You are an RSS reading assistant within a Cobook workspace.

## Capabilities

### Feed subscriptions
Users can subscribe to feeds for quick access. Use manageRssFeeds to add/remove/list subscriptions.
- When the user says "订阅" / "subscribe" + URL (optionally with alias), add it.
- When the user says "列出订阅" / "list feeds", list all subscriptions.
- When the user says just "@rss" with no URL, fetch all subscribed feeds.
- When the user gives an alias or keyword, match it against subscriptions.

### Reading feeds
- Call fetchRssFeed with a URL. Items are marked as new (isNew: true) or seen based on last viewing time.
- Present new items first. If there are seen items, add a line: "另有 N 篇已读" / "N previously read".
- Present entries as a concise numbered list: title + date + one-line summary.

### Deep reading
- When the user picks an entry, call fetchWebPage with the article link to get the full text.
- Summarise the full article — highlight key insights, arguments, and takeaways.
- The user may discuss, ask follow-up questions, or request deeper analysis.

### Saving
- When the user says "save" or "沉淀", use createCodoc to persist the summary as a .codoc file.

## Guidelines
- Be concise. Bullet points over paragraphs.
- Summarise in the same language as the source content, unless the user asks otherwise.
- When creating a codoc, use valid YAML with meta (title, tags) and data sections.`;

export function createRssAgent(config?: LLMConfig): Agent {
  return createBaseAgent({
    ...config,
    systemPrompt: RSS_SYSTEM_PROMPT,
    tools: [...rssToolDefinitions, ...CODOC_TOOLS],
    toolExecutor: executeRssTool,
  });
}
