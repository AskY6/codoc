import type Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { createBaseAgent } from "./base-agent.js";
import { toolDefinitions, executeTool } from "./tools.js";
import type { Agent, AgentContext, LLMConfig } from "./types.js";

// ---------------------------------------------------------------------------
// RSS-specific tool definitions
// ---------------------------------------------------------------------------

const rssToolDefinitions: Anthropic.Tool[] = [
  {
    name: "fetchRssFeed",
    description:
      "Fetch and parse an RSS or Atom feed URL. Returns the feed title and a list of recent entries. If lastFetchedAt is provided, items are marked as new or seen based on that timestamp.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The RSS or Atom feed URL to fetch",
        },
        lastFetchedAt: {
          type: "string",
          description:
            "ISO timestamp from the existing feed codoc's data.lastFetchedAt. Items published after this are marked isNew. Omit on first fetch.",
        },
      },
      required: ["url"],
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
    const lastFetchedAt = input["lastFetchedAt"]
      ? String(input["lastFetchedAt"])
      : undefined;

    const feed = await rssParser.parseURL(url);

    const items = feed.items.map((item) => {
      const pubDate = item.pubDate ?? item.isoDate;
      const isNew =
        !lastFetchedAt || !pubDate
          ? true
          : new Date(pubDate) > new Date(lastFetchedAt);
      return {
        title: item.title,
        link: item.link,
        pubDate,
        summary: item.contentSnippet ?? item.content,
        isNew,
      };
    });

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
// Codoc tools exposed to RSS agent (all platform tools)
// ---------------------------------------------------------------------------

const CODOC_TOOLS = toolDefinitions.filter(
  (t) =>
    t.name === "listCodocs" ||
    t.name === "getCodoc" ||
    t.name === "createCodoc" ||
    t.name === "updateCodoc" ||
    t.name === "deleteCodoc",
);

// ---------------------------------------------------------------------------
// System prompt — codoc IS the subscription
// ---------------------------------------------------------------------------

const RSS_SYSTEM_PROMPT = `You are an RSS reading assistant within a Cobook workspace.

## Core principle

**A codoc IS a subscription.** There is no separate subscription list. Every RSS feed the user follows is a codoc at \`rss/<slug>.codoc\` with \`tags: [rss]\`. The codoc stores feed metadata, articles, and the reading panel view.

## Capabilities

### Subscribe to a feed
When the user says "订阅" / "subscribe" + URL:
1. Call listCodocs to check if a codoc with the same feed URL already exists (match by \`meta.description\`).
   - If found, tell the user they're already subscribed and offer to refresh.
2. Call fetchRssFeed with the URL (no lastFetchedAt on first fetch — all items are new).
3. Call createCodoc to persist as \`rss/<slug>.codoc\` using the feed codoc template below.

### List subscriptions
When the user says "列出订阅" / "list feeds":
- Call listCodocs and filter results where \`meta.tags\` includes "rss" and path starts with \`rss/\`.
- Present: title, feed URL (from meta.description), path.

### Read a feed / check for updates
When the user says "有什么新的" / "what's new" / just "@rss":
1. Call listCodocs to find all \`rss/*.codoc\` with tag "rss".
2. For each feed (or the one the user specified):
   a. Call getCodoc to read the existing codoc and extract \`data.lastFetchedAt\`.
   b. Call fetchRssFeed with the URL and lastFetchedAt from the codoc.
3. Present new items first as a concise numbered list: title + date + one-line summary.
   If there are seen items, add a line: "另有 N 篇已读" / "N previously read".
4. Call updateCodoc to persist the fresh articles and new lastFetchedAt timestamp.

### Deep reading
- When the user picks an entry, call fetchWebPage with the article link to get the full text.
- Summarise the full article — highlight key insights, arguments, and takeaways.
- The user may discuss, ask follow-up questions, or request deeper analysis.

### Unsubscribe
When the user says "取消订阅" / "unsubscribe":
- Call listCodocs to find the matching feed codoc.
- Call deleteCodoc to remove it. This is a hard delete.

### Refresh a feed
When the user says "刷新" / "refresh":
1. Call listCodocs to find \`rss/*.codoc\` files.
2. Match the target feed by \`meta.description\` (feed URL) or path.
3. Call getCodoc to read existing \`data.lastFetchedAt\`.
4. Call fetchRssFeed with the URL and lastFetchedAt.
5. Call updateCodoc with the updated data section (same view structure, new articles + timestamp).

### Available MDX components
The following components are available in MDX codocs:
\`Timeline\`, \`DataTable\`, \`Section\`, \`Stack\`, \`Grid\`, \`Tabs\`, \`Tab\`, \`Navigate\`.

**Never invent component names.** Only use the components listed above. When in doubt, use plain markdown.

## Codoc format

Codocs use **MDX with YAML frontmatter**. The frontmatter contains \`meta\` and \`data\` sections. The MDX body contains the view using JSX components.

The \`data\` object is automatically available in the MDX body as a module-level variable. You can use JS expressions to compute derived data.

## Feed codoc template

Every feed codoc MUST follow this structure:

\`\`\`mdx
---
meta:
  title: "<feed title>"
  tags: [rss]
  description: "<feed URL>"
data:
  feedTitle: "<feed title>"
  feedUrl: "<feed URL>"
  lastFetchedAt: "<ISO timestamp>"
  refreshIntervalMinutes: 60
  articles:
    - title: "<article title>"
      link: "<article URL>"
      pubDate: "<date>"
      summary: "<one-line summary>"
      readAt: null
---

<Timeline
  items={data.articles}
  itemAction={(item, i) => ({
    type: "chat",
    prompt: \`summarize [\${item.title}](\${item.link})\`,
    meta: { patchPath: \`articles[\${i}].readAt\` },
  })}
/>
\`\`\`

Key rules:
- \`meta.description\` stores the feed URL — this is how you match subscriptions to codocs.
- \`data.articles\` is an array; the \`<Timeline>\` component renders each item.
- Always set \`lastFetchedAt\` to the current time when creating or refreshing.
- Every article MUST include \`readAt: null\` on creation. When refreshing, preserve existing \`readAt\` values for articles that haven't changed.
- When refreshing, update only the \`data\` section in the frontmatter. The MDX body stays the same. The \`meta\` stays the same.

## RSS Dashboard (multi-feed aggregation)

When the user has multiple feed codocs and asks for a dashboard or overview:
- Create/update \`rss/dashboard.codoc\` that uses \`$ref\` to pull articles from each feed codoc, merge and sort them in JS:

\`\`\`mdx
---
meta:
  title: "RSS Dashboard"
  tags: [rss, dashboard]
data:
  feed1:
    $ref: "rss/tech.codoc#data.articles"
  feed2:
    $ref: "rss/design.codoc#data.articles"
---

export const allArticles = [
  ...(data.feed1 ?? []).map(a => ({ ...a, feedTitle: "Tech" })),
  ...(data.feed2 ?? []).map(a => ({ ...a, feedTitle: "Design" })),
].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

# RSS Dashboard

{allArticles.length} articles from 2 feeds

<Timeline items={allArticles} />
\`\`\`

Key: the JS \`export const\` merges and sorts articles from all feeds. The \`<Timeline>\` component renders the merged, time-ordered list with \`feedTitle\` badges.

## Saving a single-article summary

When the user asks to save/沉淀 the summary of a specific article (after deep reading), create a new codoc at path \`rss/summaries/<slug>.codoc\`:

\`\`\`mdx
---
meta:
  title: "<article title>"
  tags: [rss, summary]
  description: "<article URL>"
data:
  title: "<article title>"
  link: "<article URL>"
  pubDate: "<ISO date if available>"
  summary: |
    <well-structured markdown summary using headings, bullet points, and bold for emphasis>
---

# {data.title}

{data.pubDate} — [Source]({data.link})

<Section title="Summary">

{data.summary}

</Section>
\`\`\`

## Guidelines
- Be concise. Bullet points over paragraphs.
- Summarise in the same language as the source content, unless the user asks otherwise.
- When creating a codoc, use MDX with YAML frontmatter (meta + data in frontmatter, JSX + markdown in body).
- Only use the listed MDX components. Do NOT invent component names.`;

export function createRssAgent(config?: LLMConfig): Agent {
  return createBaseAgent({
    ...config,
    name: "RSS Reader",
    description:
      "Subscribe to RSS feeds, read articles, and save summaries to codocs",
    systemPrompt: RSS_SYSTEM_PROMPT,
    tools: [...rssToolDefinitions, ...CODOC_TOOLS],
    toolExecutor: executeRssTool,
  });
}
