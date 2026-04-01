export interface ParsedFeedItem {
  title?: string;
  link?: string;
  description?: string;
  publishedAt?: string;
  id?: string;
}

export function parseRssSourceContent(text: string, limit?: number): ParsedFeedItem[] {
  const rssChannel = extractFirstTag(text, "channel");
  if (rssChannel) {
    return applyLimit(extractTagBlocks(rssChannel, "item").map(parseRssItem), limit);
  }

  const atomEntries = extractTagBlocks(text, "entry");
  if (atomEntries.length > 0) {
    return applyLimit(atomEntries.map(parseAtomEntry), limit);
  }

  throw new Error('RSS source did not contain an RSS "channel" or Atom "entry" payload.');
}

function parseRssItem(item: string): ParsedFeedItem {
  const title = extractTagText(item, "title");
  const link = extractTagText(item, "link");
  const description = extractTagText(item, "description");
  const publishedAt = extractTagText(item, "pubDate");
  const id = extractTagText(item, "guid");

  return {
    ...(title !== null ? { title } : {}),
    ...(link !== null ? { link } : {}),
    ...(description !== null ? { description } : {}),
    ...(publishedAt !== null ? { publishedAt } : {}),
    ...(id !== null ? { id } : {})
  };
}

function parseAtomEntry(entry: string): ParsedFeedItem {
  const linkTag = entry.match(/<link\b[^>]*>/i);
  const title = extractTagText(entry, "title");
  const link = linkTag ? extractAttribute(linkTag[0], "href") : null;
  const summary = extractTagText(entry, "summary");
  const content = extractTagText(entry, "content");
  const updated = extractTagText(entry, "updated");
  const published = extractTagText(entry, "published");
  const id = extractTagText(entry, "id");

  return {
    ...(title !== null ? { title } : {}),
    ...(link !== null ? { link } : {}),
    ...(summary !== null
      ? { description: summary }
      : content !== null
        ? { description: content }
        : {}),
    ...(updated !== null
      ? { publishedAt: updated }
      : published !== null
        ? { publishedAt: published }
        : {}),
    ...(id !== null ? { id } : {})
  };
}

function applyLimit(items: ParsedFeedItem[], limit?: number): ParsedFeedItem[] {
  if (typeof limit !== "number") {
    return items;
  }

  return items.slice(0, limit);
}

function extractTagBlocks(xml: string, tagName: string): string[] {
  const matches = xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"));
  return Array.from(matches, (match) => match[1] ?? "");
}

function extractFirstTag(xml: string, tagName: string): string | null {
  const match = extractFirstTagMatch(xml, tagName);
  return match?.[1] ?? null;
}

function extractFirstTagMatch(xml: string, tagName: string): RegExpMatchArray | null {
  return new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
}

function extractTagText(xml: string, tagName: string): string | null {
  const raw = extractFirstTag(xml, tagName);
  if (!raw) {
    return null;
  }

  return normalizeXmlText(raw);
}

function extractAttribute(tag: string, attribute: string): string | null {
  const match = new RegExp(`${attribute}="([^"]*)"`, "i").exec(tag);
  return match?.[1] ? decodeXmlEntities(match[1]) : null;
}

function normalizeXmlText(value: string): string {
  const withoutCdata = value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();

  return decodeXmlEntities(withoutCdata);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}
