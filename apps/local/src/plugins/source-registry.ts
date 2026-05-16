// Source registry assembly — host-side glue for Phase 1.5.
//
// Built-in `httpJsonProvider` comes from @cobook/parser; vertical scheme
// providers (rss, ...) live in their owning plugin and are mixed in here.
//
// TEMPORARY: Phase 2 replaces this hardcoded plugin import with manifest-
// driven discovery (read plugins/*/manifest.json, dynamic-import each
// `contributes.sourceProviders[].entry`, merge into registry).

import { createSourceRegistry } from "@cobook/parser";
import type { SourceRegistry } from "@cobook/parser";
import { rssProvider } from "../../plugins/rss/server/index.js";

/** Build a SourceRegistry with all built-in + plugin-owned providers. */
export function buildSourceRegistry(): SourceRegistry {
  const base = createSourceRegistry();
  return new Map([...base, [rssProvider.name, rssProvider]]);
}
