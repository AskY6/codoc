// RSS domain tools — feed fetching and web page reading.
//
// These tools are only given to the RSS specialist agent.
// Platform tools (codoc CRUD) are added separately.

import type { Result } from "@cobook/core";
import { err, ok } from "@cobook/core";
import type { ToolError, ToolId } from "@cobook/graph";
import Parser from "rss-parser";
import type { ChatTool } from "../state/aliases.js";

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

const fetchRssFeedTool: ChatTool = {
  schema: {
    id: "fetchRssFeed" as ToolId,
    name: "fetchRssFeed",
    description:
      "Fetch and parse an RSS or Atom feed URL. Returns the feed title and a list of recent entries. If lastFetchedAt is provided, items are marked as new or seen based on that timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The RSS or Atom feed URL to fetch",
        },
        lastFetchedAt: {
          type: "string",
          description:
            "ISO timestamp. Items published after this are marked isNew. Omit on first fetch.",
        },
      },
      required: ["url"],
    },
  },
  async execute(input): Promise<Result<unknown, ToolError>> {
    const { url, lastFetchedAt } = input as {
      url: string;
      lastFetchedAt?: string;
    };
    try {
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
      return ok({
        title: feed.title,
        description: feed.description,
        link: feed.link,
        items,
        newCount,
        seenCount: items.length - newCount,
      });
    } catch (e) {
      return err({
        kind: "execution",
        message: `Failed to fetch RSS feed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  },
};

const fetchWebPageTool: ChatTool = {
  schema: {
    id: "fetchWebPage" as ToolId,
    name: "fetchWebPage",
    description:
      "Fetch the full content of a web page. Returns cleaned text (scripts/styles removed) for LLM summarisation.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The web page URL to fetch",
        },
      },
      required: ["url"],
    },
  },
  async execute(input): Promise<Result<unknown, ToolError>> {
    const { url } = input as { url: string };
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Cobook-RSS/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return err({
          kind: "execution",
          message: `HTTP ${res.status} ${res.statusText}`,
        });
      }
      const html = await res.text();
      const content = stripHtmlBoilerplate(html).slice(0, MAX_PAGE_CHARS);
      return ok({ url, content });
    } catch (e) {
      return err({
        kind: "execution",
        message: `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  },
};

export function createRssTools(): readonly ChatTool[] {
  return [fetchRssFeedTool, fetchWebPageTool];
}
