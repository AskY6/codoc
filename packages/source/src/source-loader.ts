import type { CodataField, FieldError, ForceContext, LoaderFn, SourceConnectorConfig } from "@codoc/core";
import { getConnector } from "./connector-registry.js";
import { getCredentialStore } from "./auth/credential-store.js";
import { fetchWithCacheStrategy, buildConnectorCacheKey } from "./cache/store.js";

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

  // String -> URL fetch
  if (typeof source === "string") {
    return fetchWithCacheStrategy(source, ttl, swr, () => fetchUrl(source));
  }

  // Object -> connector dispatch
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
