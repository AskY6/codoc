// rss source provider.
//
// Fetches an RSS or Atom feed URL and returns parsed entries as an array
// of plain objects. Params:
//   url   — required, the feed URL
//   limit — optional, max number of items to return

import { createHash } from "node:crypto";
import type { MergeContext, SourceProvider } from "./source.js";

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

  merge(existing: unknown, incoming: unknown, ctx?: MergeContext): unknown {
    return mergeRssArticles(existing, incoming, ctx?.slug);
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
  guid: string;
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
      guid: tagText(match[1]!, "guid"),
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
      guid: tagText(match[1]!, "id"),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Link normalization
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid",
]);

function normalizeLink(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    // Normalize protocol to https
    if (url.protocol === "http:") url.protocol = "https:";
    // Strip tracking params
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
    }
    // Strip trailing slash from pathname
    if (url.pathname.endsWith("/") && url.pathname.length > 1) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Article ID generation
// ---------------------------------------------------------------------------

/**
 * Compute a stable article ID from source slug + preferred key.
 * Priority: guid > normalizedLink > hash(title + pubDate)
 */
function computeArticleId(slug: string, item: FeedItem): string {
  const preferredKey = item.guid
    || normalizeLink(item.link)
    || `${item.title}::${item.pubDate}`;
  return hashId(`${slug}::${preferredKey}`);
}

/** Deterministic short hash (first 16 hex chars of SHA-256). */
function hashId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Compute the merge key for deduplication.
 * Uses the same priority as articleId to ensure consistency.
 */
function mergeKey(item: Pick<RssArticle, "guid" | "link" | "title" | "pubDate">): string {
  return item.guid || normalizeLink(item.link ?? "") || `${item.title ?? ""}::${item.pubDate ?? ""}`;
}

// ---------------------------------------------------------------------------
// RSS merge — by preferredKey, preserving user state (readAt, starred)
// ---------------------------------------------------------------------------

export interface RssArticle {
  articleId?: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  readAt?: string | null;
  starred?: boolean;
}

function mergeRssArticles(existing: unknown, incoming: unknown, slug?: string): RssArticle[] {
  const newItems = (Array.isArray(incoming) ? incoming : []) as FeedItem[];
  if (newItems.length === 0) return asArticles(existing);

  const prev = asArticles(existing);
  const byKey = new Map<string, RssArticle>();
  for (const a of prev) {
    const key = a.articleId
      ? mergeKey(a)
      : (a.link || `${a.title ?? ""}::${a.pubDate ?? ""}`);
    if (key) byKey.set(key, a);
  }

  const merged: RssArticle[] = [];

  for (const item of newItems) {
    const key = mergeKey(item);
    const old = key ? byKey.get(key) : undefined;
    const articleId = slug ? computeArticleId(slug, item) : (old?.articleId);

    if (old) {
      const base: RssArticle = { ...item, readAt: old.readAt ?? null, starred: old.starred ?? false };
      if (articleId) base.articleId = articleId;
      merged.push(base);
      byKey.delete(key);
    } else {
      const base: RssArticle = { ...item, readAt: null, starred: false };
      if (articleId) base.articleId = articleId;
      merged.push(base);
    }
  }

  // Keep existing articles no longer in the feed.
  for (const leftover of byKey.values()) {
    // Backfill articleId for leftovers if slug is available
    if (slug && !leftover.articleId) {
      leftover.articleId = computeArticleId(slug, leftover as unknown as FeedItem);
    }
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
