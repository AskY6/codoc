// Built-in source providers.

import type { SourceRegistry } from "./source.js";
import { httpJsonProvider } from "./http-json.js";

/** Default registry with all built-in providers. */
export function createSourceRegistry(): SourceRegistry {
  return new Map([
    [httpJsonProvider.name, httpJsonProvider],
  ]);
}
