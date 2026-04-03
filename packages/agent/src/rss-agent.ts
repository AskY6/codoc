import type Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { createBaseAgent } from "./base-agent.js";
import { toolDefinitions, executeTool } from "./tools.js";
import type { Agent, AgentContext, LLMConfig } from "./types.js";

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
];

// ---------------------------------------------------------------------------
// RSS tool executor
// ---------------------------------------------------------------------------

const rssParser = new Parser();

async function executeRssTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<unknown> {
  if (name === "fetchRssFeed") {
    const url = String(input["url"]);
    const feed = await rssParser.parseURL(url);
    return {
      title: feed.title,
      description: feed.description,
      link: feed.link,
      items: feed.items.map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate ?? item.isoDate,
        summary: item.contentSnippet ?? item.content,
      })),
    };
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

Your workflow:
1. When the user gives you an RSS feed URL, call fetchRssFeed to retrieve the entries.
2. Present the entries as a concise numbered list (title + date + one-line summary).
3. The user will pick entries to dive into. Summarise the selected entries based on the feed content — highlight key insights, arguments, and takeaways.
4. The user may discuss, ask follow-up questions, or request deeper analysis. Engage naturally.
5. When the user says "save" or "沉淀", use createCodoc to persist the final summary into the workspace as a .codoc file. Choose a descriptive path based on the content.

Guidelines:
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
