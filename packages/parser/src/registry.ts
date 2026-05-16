// Built-in source providers.
//
// Generic, domain-agnostic providers only. Vertical schemes (rss, etc.)
// ship in their owning plugin and are merged into the registry by the host.

import type { SourceRegistry } from "./source.js";
import { httpJsonProvider } from "./http-json.js";

/** Default registry with all built-in providers. */
export function createSourceRegistry(): SourceRegistry {
  return new Map([
    [httpJsonProvider.name, httpJsonProvider],
  ]);
}
