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

  merge(existing: unknown, incoming: unknown): unknown {
    return mergeRssArticles(existing, incoming);
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

// ---------------------------------------------------------------------------
// RSS merge — by link, preserving user state (readAt, starred)
// ---------------------------------------------------------------------------

interface RssArticle {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  readAt?: string | null;
  starred?: boolean;
}

function mergeRssArticles(existing: unknown, incoming: unknown): RssArticle[] {
  const newItems = (Array.isArray(incoming) ? incoming : []) as RssArticle[];
  if (newItems.length === 0) return asArticles(existing);

  const prev = asArticles(existing);
  const byLink = new Map<string, RssArticle>();
  for (const a of prev) {
    if (a.link) byLink.set(a.link, a);
  }

  const merged: RssArticle[] = [];

  for (const item of newItems) {
    const old = item.link ? byLink.get(item.link) : undefined;
    if (old) {
      merged.push({ ...item, readAt: old.readAt ?? null, starred: old.starred ?? false });
      byLink.delete(item.link);
    } else {
      merged.push({ ...item, readAt: null, starred: false });
    }
  }

  // Keep existing articles no longer in the feed.
  for (const leftover of byLink.values()) {
    merged.push(leftover);
  }

  return capArticles(merged, 200);
}

/**
 * Cap the article list to at most `max` items.
 * Keeps all unread and starred articles; trims oldest read/unstarred first.
 */
function capArticles(articles: RssArticle[], max: number): RssArticle[] {
  if (articles.length <= max) return articles;

  const keep: RssArticle[] = [];
  const trimmable: RssArticle[] = [];

  for (const a of articles) {
    if (!a.readAt || a.starred) {
      keep.push(a);
    } else {
      trimmable.push(a);
    }
  }

  // If protected items already exceed max, return them all (no data loss).
  if (keep.length >= max) return keep;

  // Sort trimmable by pubDate desc — keep newest.
  trimmable.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  const remaining = max - keep.length;
  return [...keep, ...trimmable.slice(0, remaining)];
}

function asArticles(val: unknown): RssArticle[] {
  return Array.isArray(val) ? (val as RssArticle[]) : [];
}
