// rss source provider.
//
// Fetches an RSS or Atom feed URL and returns parsed entries as an array
// of plain objects. Params:
//   url   — required, the feed URL
//   limit — optional, max number of items to return

import type { SourceProvider } from "./source.js";

export const rssProvider: SourceProvider = {
  name: "rss",

  async execute(params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const url = params["url"];
    if (typeof url !== "string" || !url) {
      throw new Error('rss: "url" param is required and must be a string');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`rss: ${response.status} ${response.statusText} from ${url}`);
    }

    const xml = await response.text();
    const items = parseRssItems(xml).concat(parseAtomEntries(xml));

    if (items.length === 0) {
      throw new Error("rss: no <item> or <entry> elements found in feed");
    }

    const limit = params["limit"];
    if (typeof limit === "number" && limit > 0) {
      return items.slice(0, limit);
    }

    return items;
  },
};

// ---------------------------------------------------------------------------
// Minimal XML parsing (no external deps)
// ---------------------------------------------------------------------------

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

/** Extract text content of an XML element by tag name. */
function tagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = re.exec(xml);
  if (!match) return "";
  return match[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** Extract href from <link href="..." /> (Atom style). */
function atomLink(xml: string): string {
  const re = /<link[^>]*href\s*=\s*"([^"]*)"[^>]*\/?>/i;
  const match = re.exec(xml);
  return match?.[1] ?? "";
}

/** Parse RSS 2.0 <item> elements. */
function parseRssItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    items.push({
      title: tagText(match[1]!, "title"),
      link: tagText(match[1]!, "link"),
      description: tagText(match[1]!, "description"),
      pubDate: tagText(match[1]!, "pubDate"),
    });
  }
  return items;
}

/** Parse Atom <entry> elements. */
function parseAtomEntries(xml: string): FeedItem[] {
  const entries: FeedItem[] = [];
  const re = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    entries.push({
      title: tagText(match[1]!, "title"),
      link: atomLink(match[1]!) || tagText(match[1]!, "link"),
      description: tagText(match[1]!, "summary") || tagText(match[1]!, "content"),
      pubDate: tagText(match[1]!, "published") || tagText(match[1]!, "updated"),
    });
  }
  return entries;
}
