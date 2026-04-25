// source-scheduler — generic per-source-field background refresh.
//
// Scans workspace for $source fields with `interval`, checks timing
// against .source-state.json, and refreshes when due. Merge strategy
// is provider-specific: RSS merges by link (preserving readAt/starred),
// all others use replace.

import type { CodocPath, FieldName, NodeId, ResolveResult } from "@cobook/core";
import type { SourceProvider } from "@cobook/parser";
import type { Workspace } from "./workspace.js";
import { compileOne } from "./workspace.js";
import {
  readSourceState,
  writeSourceState,
  withEntry,
  type SourceStateMap,
} from "./source-state.js";

const CHECK_INTERVAL_MS = 60 * 1000; // check every 1 minute

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SourceScheduler {
  /** Stop the scheduler. Safe to call multiple times. */
  stop(): void;
}

/**
 * Start a generic source-field refresh scheduler for a workspace.
 * Scans for all $source fields with `interval`, refreshes when due.
 */
export function startSourceScheduler(ws: Workspace): SourceScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;

    const entries = findPeriodicSources(ws);
    if (entries.length === 0) return;

    const state = await readSourceState(ws.sourceDir);
    const due = entries.filter((e) => isDue(e, state));
    if (due.length === 0) return;

    console.log(`[source] ${due.length} source(s) due for refresh`);

    let currentState = state;

    for (const entry of due) {
      if (stopped) return;
      try {
        currentState = await refreshSource(ws, entry, currentState);
      } catch (e) {
        console.warn(
          `[source] failed to refresh ${entry.nodeId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // Immediate first check, then every minute.
  void tick();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  console.log("[source] scheduler started (checking every 60s)");

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[source] scheduler stopped");
    },
  };
}

// ---------------------------------------------------------------------------
// Periodic source discovery
// ---------------------------------------------------------------------------

interface PeriodicSource {
  nodeId: NodeId;
  codocPath: CodocPath;
  fieldName: FieldName;
  source: string;
  params: Readonly<Record<string, unknown>>;
  interval: number;
  provider: SourceProvider;
}

function findPeriodicSources(ws: Workspace): PeriodicSource[] {
  const result: PeriodicSource[] = [];

  for (const [codocPath, codoc] of ws.codocs) {
    for (const [fieldName, field] of codoc.ast.data) {
      if (field.kind !== "source" || field.fetch.kind !== "periodic") continue;

      const provider = ws.sourceProviders.get(field.source);
      if (!provider) continue;

      result.push({
        nodeId: `${codocPath}#data.${fieldName}` as NodeId,
        codocPath,
        fieldName,
        source: field.source,
        params: field.params,
        interval: field.fetch.interval,
        provider,
      });
    }
  }

  return result;
}

function isDue(entry: PeriodicSource, state: SourceStateMap): boolean {
  const s = state[entry.nodeId];
  if (!s?.lastFetchedAt) return true; // never fetched
  const elapsed = Date.now() - new Date(s.lastFetchedAt).getTime();
  return elapsed >= entry.interval * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Refresh a single source
// ---------------------------------------------------------------------------

async function refreshSource(
  ws: Workspace,
  entry: PeriodicSource,
  state: SourceStateMap,
): Promise<SourceStateMap> {
  const raw = await entry.provider.execute(entry.params);

  // Merge strategy: RSS uses article-level merge; others use replace.
  const existing = state[entry.nodeId]?.cachedValue;
  const merged =
    entry.source === "rss"
      ? mergeRssArticles(existing, raw)
      : raw;

  // Update state file.
  const newState = withEntry(state, entry.nodeId, {
    lastFetchedAt: new Date().toISOString(),
    cachedValue: merged,
  });
  await writeSourceState(ws.sourceDir, newState);

  // Update in-memory resolved data.
  const codoc = ws.codocs.get(entry.codocPath);
  if (codoc) {
    const updated = {
      ...codoc,
      resolvedData: {
        ...codoc.resolvedData,
        [entry.fieldName]: { kind: "ready" as const, value: merged } satisfies ResolveResult,
      },
    };
    ws.codocs.set(entry.codocPath, updated);
    await compileOne(ws, updated);
  }

  // Log summary.
  if (entry.source === "rss" && Array.isArray(merged) && Array.isArray(existing)) {
    const newCount = merged.length - existing.length;
    if (newCount > 0) {
      console.log(`[source] ${entry.nodeId}: ${newCount} new article(s)`);
    } else {
      console.log(`[source] ${entry.nodeId}: up to date`);
    }
  } else {
    console.log(`[source] ${entry.nodeId}: refreshed`);
  }

  return newState;
}

// ---------------------------------------------------------------------------
// RSS merge — by link, preserving user state (readAt, starred)
// ---------------------------------------------------------------------------

interface RssArticle {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  readAt?: string | null;
  starred?: boolean;
}

function mergeRssArticles(existing: unknown, incoming: unknown): RssArticle[] {
  const newItems = (Array.isArray(incoming) ? incoming : []) as RssArticle[];
  if (newItems.length === 0) return asArticles(existing);

  const prev = asArticles(existing);
  const byLink = new Map<string, RssArticle>();
  for (const a of prev) {
    if (a.link) byLink.set(a.link, a);
  }

  const merged: RssArticle[] = [];

  for (const item of newItems) {
    const old = item.link ? byLink.get(item.link) : undefined;
    if (old) {
      merged.push({ ...item, readAt: old.readAt ?? null, starred: old.starred ?? false });
      byLink.delete(item.link);
    } else {
      merged.push({ ...item, readAt: null, starred: false });
    }
  }

  // Keep existing articles no longer in the feed.
  for (const leftover of byLink.values()) {
    merged.push(leftover);
  }

  return merged;
}

function asArticles(val: unknown): RssArticle[] {
  return Array.isArray(val) ? (val as RssArticle[]) : [];
}
