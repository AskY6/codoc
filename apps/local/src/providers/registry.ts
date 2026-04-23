// providers/registry — Discovers and exposes available CLI providers.
//
// On startup, detect() is called in parallel on all registered providers.
// The registry then serves as a lookup table for chat-route.ts.

import type { ChatProvider, ProviderInfo } from "./types.js";
import { claudeCodeProvider } from "./claude-code.js";
import { codexProvider } from "./codex.js";
import { kiroProvider } from "./kiro.js";

/** All known providers, in display order. */
const ALL_PROVIDERS: ChatProvider[] = [
  claudeCodeProvider,
  codexProvider,
  kiroProvider,
];

export interface ProviderRegistry {
  /** Providers that passed detect() — guaranteed to have the binary installed. */
  readonly available: ReadonlyMap<string, ChatProvider>;
  /** Full list with availability status, for UI display. */
  readonly info: readonly ProviderInfo[];
  /** Look up a provider by id; returns undefined if not available. */
  get(id: string): ChatProvider | undefined;
}

/** Probe all providers in parallel and build the registry. */
export async function createProviderRegistry(): Promise<ProviderRegistry> {
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      let ok = false;
      try {
        ok = await p.detect();
      } catch {
        ok = false;
      }
      return { provider: p, available: ok };
    }),
  );

  const available = new Map<string, ChatProvider>();
  const info: ProviderInfo[] = [];

  for (const { provider, available: ok } of results) {
    if (ok) available.set(provider.id, provider);
    info.push({ id: provider.id, name: provider.name, available: ok });
  }

  return {
    available,
    info,
    get(id: string) {
      return available.get(id);
    },
  };
}
