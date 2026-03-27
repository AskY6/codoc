import type { CodataField, FieldError, ForceContext, LoaderFn } from "../types.js";

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearSourceCache(): void {
  cache.clear();
}

export function getSourceCacheSize(): number {
  return cache.size;
}

export const sourceLoader: LoaderFn = async (
  field: CodataField,
  _context: ForceContext
): Promise<unknown> => {
  const decl = field.meta.loader;
  if (decl.type !== "source") {
    throw new Error(`sourceLoader called on non-source field: ${field.path}`);
  }

  const url = decl.$source;
  const ttl = decl.ttl ?? 0;
  const swr = decl.staleWhileRevalidate ?? false;
  const now = Date.now();

  // Check cache
  const cached = cache.get(url);
  if (cached) {
    if (now < cached.expiresAt) {
      return cached.value;
    }
    // Expired but stale-while-revalidate: return stale and refresh in background
    if (swr) {
      fetchAndCache(url, ttl).catch(() => {});
      return cached.value;
    }
  }

  return fetchAndCache(url, ttl);
};

async function fetchAndCache(url: string, ttl: number): Promise<unknown> {
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

  if (ttl > 0) {
    cache.set(url, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  return value;
}
