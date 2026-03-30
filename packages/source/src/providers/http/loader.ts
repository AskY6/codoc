import type { FieldError } from "@codoc/core";

/**
 * Fetch a URL and return the parsed response.
 * Used by the source loader for string $source values.
 */
export async function fetchUrl(url: string): Promise<unknown> {
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
