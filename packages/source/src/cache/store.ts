interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearSourceCache(): void {
  cache.clear();
}

export function evictSourceCache(key: string): boolean {
  return cache.delete(key);
}

export function getSourceCacheSize(): number {
  return cache.size;
}

/**
 * Shared cache strategy for both URL and connector paths.
 */
export async function fetchWithCacheStrategy(
  cacheKey: string,
  ttl: number,
  swr: boolean,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached) {
    if (now < cached.expiresAt) {
      return cached.value;
    }
    if (swr) {
      fetchAndStore(cacheKey, ttl, fetcher).catch(() => {});
      return cached.value;
    }
  }

  return fetchAndStore(cacheKey, ttl, fetcher);
}

async function fetchAndStore(
  cacheKey: string,
  ttl: number,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const value = await fetcher();
  if (ttl > 0) {
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttl * 1000 });
  }
  return value;
}

/**
 * Deterministic JSON serialization for cache keys.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  return "{" + sorted.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Build a deterministic cache key for a connector source.
 */
export function buildConnectorCacheKey(source: { connector: string; [key: string]: unknown }): string {
  const { connector, ...config } = source;
  return `connector:${connector}:${stableStringify(config)}`;
}
