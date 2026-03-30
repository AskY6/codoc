import type { CodataField, FieldError, ForceContext, LoaderFn, SourceConnectorConfig } from "../types.js";
import { getConnector } from "../connector/registry.js";
import { getCredentialStore } from "../connector/credential-store.js";

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
 * Deterministic JSON serialization for cache keys.
 * Sorts object keys so the same config always produces the same string.
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
export function buildConnectorCacheKey(source: SourceConnectorConfig): string {
  const { connector, ...config } = source;
  return `connector:${connector}:${stableStringify(config)}`;
}

export const sourceLoader: LoaderFn = async (
  field: CodataField,
  _context: ForceContext
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "source") {
    throw new Error(`sourceLoader called on non-source field: ${field.path}`);
  }

  const source = decl.$source;
  const ttl = decl.ttl ?? 0;
  const swr = decl.staleWhileRevalidate ?? false;

  // String → URL fetch (original path)
  if (typeof source === "string") {
    return fetchWithCacheStrategy(source, ttl, swr, () => fetchUrl(source));
  }

  // Object → connector dispatch
  const { connector: connectorName, ...config } = source;
  const connectorFn = getConnector(connectorName);
  if (!connectorFn) {
    const error: FieldError = {
      kind: "source",
      message: `Unknown connector: "${connectorName}"`,
      retryable: false,
    };
    throw error;
  }

  const cacheKey = buildConnectorCacheKey(source);
  return fetchWithCacheStrategy(cacheKey, ttl, swr, async () => {
    const auth = getCredentialStore().get(connectorName);
    return connectorFn(config, auth);
  });
};

/**
 * Shared cache strategy for both URL and connector paths.
 */
async function fetchWithCacheStrategy(
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

async function fetchUrl(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const error: FieldError = {
      kind: "source",
      message: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
      url,
      retryable: true,
      cause: err,
    };
    throw error;
  }

  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 429;
    const error: FieldError = {
      kind: "source",
      message: `HTTP ${response.status}: ${response.statusText}`,
      url,
      retryable,
    };
    throw error;
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = await response.text();
  }

  return value;
}
