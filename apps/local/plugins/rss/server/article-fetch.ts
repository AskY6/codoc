// article-fetch — fetch the readable body of an article link.
//
// Uses r.jina.ai as a reader proxy: GET https://r.jina.ai/<url> returns the
// article body as clean markdown, no HTML parsing required on our side.
//
// In-memory LRU caches fetched bodies for 30 minutes / 50 entries — enough
// to bridge the gap between digest generation (writes a summary) and the
// user clicking Discuss (reuses the body for chat context).

import { fetch, ProxyAgent, type Dispatcher } from "undici";

const READER_URL = "https://r.jina.ai/";

// Honor HTTPS_PROXY / HTTP_PROXY env vars — Node's built-in fetch ignores them
// by default, which silently fails on corporate networks.
const proxyUrl =
  process.env["HTTPS_PROXY"] ||
  process.env["https_proxy"] ||
  process.env["HTTP_PROXY"] ||
  process.env["http_proxy"];
const dispatcher: Dispatcher | undefined = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
if (dispatcher) {
  console.log(`[article-fetch] using proxy ${new URL(proxyUrl!).host}`);
}
const TIMEOUT_MS = 20_000;
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50;

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly body: string;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Bump for LRU.
  cache.delete(key);
  cache.set(key, entry);
  return entry.body;
}

function putCached(key: string, body: string): void {
  cache.set(key, { body, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch an article's readable body. Returns null on any failure (network,
 * timeout, non-2xx, empty body) — callers must handle the missing-body case.
 *
 * Cached for 30 minutes per URL.
 */
export async function fetchArticleBody(link: string): Promise<string | null> {
  if (!link) return null;

  const cached = getCached(link);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(READER_URL + link, {
      headers: { "x-return-format": "markdown" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!response.ok) {
      console.warn(`[article-fetch] ${response.status} for ${link}`);
      return null;
    }

    const raw = (await response.text()).trim();
    const body = stripJinaPreamble(raw);
    if (!body || looksBlocked(body)) {
      console.warn(`[article-fetch] empty/blocked ${link}`);
      return null;
    }

    putCached(link, body);
    return body;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[article-fetch] failed ${link}: ${reason}`);
    return null;
  }
}

/**
 * Fetch many articles in parallel with bounded concurrency.
 *
 * Returns a Map keyed by link → body (or null if fetch failed).
 */
export async function fetchManyBodies(
  links: readonly string[],
  concurrency = 4,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const queue = [...new Set(links.filter(Boolean))];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const link = queue.shift();
      if (!link) return;
      const body = await fetchArticleBody(link);
      results.set(link, body);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Strip jina.ai's standard preamble (Title / URL Source / Markdown Content lines). */
function stripJinaPreamble(text: string): string {
  // jina wraps actual content after a "Markdown Content:" sentinel line.
  const idx = text.indexOf("Markdown Content:");
  if (idx >= 0) return text.slice(idx + "Markdown Content:".length).trim();
  return text;
}

/** Detect Cloudflare / bot-challenge / "just a moment" stubs. */
function looksBlocked(text: string): boolean {
  if (text.length < 200) return true;
  const head = text.slice(0, 500).toLowerCase();
  return (
    head.includes("just a moment") ||
    head.includes("checking your browser") ||
    head.includes("enable javascript") ||
    head.includes("attention required") ||
    head.includes("cloudflare")
  );
}
