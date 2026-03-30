// Cache strategy interface.

export interface CacheStrategy {
  /** Time-to-live in seconds. 0 means no caching. */
  ttl: number;
  /** If true, return stale value while revalidating in background. */
  staleWhileRevalidate: boolean;
}

export function defaultStrategy(): CacheStrategy {
  return { ttl: 0, staleWhileRevalidate: false };
}
