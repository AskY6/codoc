// scheduler — generic per-source-field background refresh.
//
// Scans workspace for $source fields with `interval`, checks timing
// against .source-state.json, and refreshes when due. Merge strategy
// is provider-owned: providers with a `merge` method get merge semantics,
// all others use replace.

import type { EventEmitter } from "node:events";
import type { CodocPath, FieldName, NodeId } from "@cobook/core";
import type { MergeContext, SourceProvider } from "@cobook/parser";
import type { Workspace } from "../workspace/index.js";
import {
  readSourceState,
  writeSourceState,
  withEntry,
  type SourceStateEntry,
  type SourceStateMap,
} from "./state.js";
import { updateSourceFieldCache } from "../workspace/service.js";
import { Mutex } from "./mutex.js";

const CHECK_INTERVAL_MS = 60 * 1000; // check every 1 minute
const CONCURRENCY_LIMIT = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SourceScheduler {
  /** Stop the scheduler. Safe to call multiple times. */
  stop(): void;
  /** Resolves when the first tick completes (all due sources refreshed). */
  readonly ready: Promise<void>;
}

export interface RefreshResult {
  readonly total: number;
  readonly refreshed: string[];
  readonly failed: { nodeId: string; error: string }[];
}

/**
 * Start a generic source-field refresh scheduler for a workspace.
 * Scans for all $source fields with `interval`, refreshes when due.
 */
export function startSourceScheduler(ws: Workspace, updates?: EventEmitter): SourceScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stateMutex = new Mutex();

  async function tick(): Promise<void> {
    if (stopped) return;

    const entries = findPeriodicSources(ws);
    if (entries.length === 0) return;

    const state = await readSourceState(ws.sourceDir);
    const due = entries.filter((e) => isDue(e, state));
    if (due.length === 0) return;

    console.log(`[source] ${due.length} source(s) due for refresh`);

    // Refresh with concurrency limit.
    await runWithConcurrency(due, CONCURRENCY_LIMIT, async (entry) => {
      if (stopped) return;
      await refreshSource(ws, entry, stateMutex, updates);
    });
  }

  // First tick blocks ready promise; subsequent ticks fire-and-forget.
  const firstTick = tick();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  console.log("[source] scheduler started (checking every 60s)");

  return {
    ready: firstTick,
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

/**
 * Refresh all periodic sources in a workspace on demand.
 * When `force` is true, all sources are refreshed regardless of timing.
 * When false, only due sources are refreshed (same as a scheduler tick).
 */
export async function refreshAllSources(
  ws: Workspace,
  updates?: EventEmitter,
  opts?: { force?: boolean },
): Promise<RefreshResult> {
  const entries = findPeriodicSources(ws);
  if (entries.length === 0) {
    return { total: 0, refreshed: [], failed: [] };
  }

  const state = await readSourceState(ws.sourceDir);
  const targets = opts?.force ? entries : entries.filter((e) => isDue(e, state));
  const refreshed: string[] = [];
  const failed: { nodeId: string; error: string }[] = [];
  const stateMutex = new Mutex();

  await runWithConcurrency(targets, CONCURRENCY_LIMIT, async (entry) => {
    try {
      await refreshSource(ws, entry, stateMutex, updates);
      refreshed.push(entry.nodeId);
    } catch (e) {
      failed.push({
        nodeId: entry.nodeId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return { total: entries.length, refreshed, failed };
}

/**
 * Refresh a single source by nodeId. Used for per-feed refresh.
 */
export async function refreshSingleSource(
  ws: Workspace,
  nodeId: NodeId,
  updates?: EventEmitter,
): Promise<void> {
  const entries = findPeriodicSources(ws);
  const entry = entries.find((e) => e.nodeId === nodeId);
  if (!entry) throw new Error(`source not found: ${nodeId}`);
  const stateMutex = new Mutex();
  await refreshSource(ws, entry, stateMutex, updates);
}

// ---------------------------------------------------------------------------
// Periodic source discovery
// ---------------------------------------------------------------------------

interface PeriodicSource {
  nodeId: NodeId;
  codocPath: CodocPath;
  fieldName: FieldName;
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
// Slug derivation
// ---------------------------------------------------------------------------

/** Derive a source slug from a codoc path (e.g. "sources/hacker-news.codoc" → "hacker-news"). */
function slugFromCodocPath(codocPath: CodocPath): string {
  const filename = String(codocPath).split("/").pop() ?? "";
  return filename.replace(/\.codoc$/, "");
}

// ---------------------------------------------------------------------------
// Refresh a single source (with health tracking)
// ---------------------------------------------------------------------------

async function refreshSource(
  ws: Workspace,
  entry: PeriodicSource,
  stateMutex: Mutex,
  updates?: EventEmitter,
): Promise<void> {
  const now = new Date().toISOString();

  // Record attempt.
  await stateMutex.acquire();
  try {
    const state = await readSourceState(ws.sourceDir);
    const existing = state[entry.nodeId];
    const updated: SourceStateEntry = {
      ...existing,
      lastFetchedAt: existing?.lastFetchedAt ?? now,
      lastAttemptAt: now,
    };
    await writeSourceState(ws.sourceDir, withEntry(state, entry.nodeId, updated));
  } finally {
    stateMutex.release();
  }

  // Execute fetch.
  let raw: unknown;
  try {
    raw = await entry.provider.execute(entry.params);
  } catch (e) {
    // Record failure.
    await stateMutex.acquire();
    try {
      const state = await readSourceState(ws.sourceDir);
      const existing = state[entry.nodeId];
      const errorMsg = e instanceof Error ? e.message : String(e);
      const updated: SourceStateEntry = {
        ...existing,
        lastFetchedAt: existing?.lastFetchedAt ?? now,
        lastAttemptAt: now,
        lastError: errorMsg,
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
      };
      await writeSourceState(ws.sourceDir, withEntry(state, entry.nodeId, updated));
    } finally {
      stateMutex.release();
    }
    console.warn(
      `[source] failed to refresh ${entry.nodeId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }

  // Merge strategy: use provider merge if available, otherwise replace.
  await stateMutex.acquire();
  let merged: unknown;
  try {
    const state = await readSourceState(ws.sourceDir);
    const existing = state[entry.nodeId]?.cachedValue;

    const mergeCtx: MergeContext = { slug: slugFromCodocPath(entry.codocPath) };
    merged = entry.provider.merge
      ? entry.provider.merge(existing, raw, mergeCtx)
      : raw;
  } finally {
    stateMutex.release();
  }

  // Delegate to service layer (this writes state + recompiles).
  await updateSourceFieldCache(
    { ws, updates },
    entry.codocPath,
    entry.fieldName,
    merged,
    now,
  );

  // Clear error state on success.
  await stateMutex.acquire();
  try {
    const state = await readSourceState(ws.sourceDir);
    const existing = state[entry.nodeId];
    if (existing) {
      const cleared: SourceStateEntry = {
        ...existing,
        lastError: null,
        consecutiveFailures: 0,
      };
      await writeSourceState(ws.sourceDir, withEntry(state, entry.nodeId, cleared));
    }
  } finally {
    stateMutex.release();
  }

  // Log summary.
  if (entry.provider.merge && Array.isArray(merged)) {
    const prevState = await readSourceState(ws.sourceDir);
    const prevCached = prevState[entry.nodeId]?.cachedValue;
    if (Array.isArray(prevCached)) {
      const newCount = (merged as unknown[]).length - (prevCached as unknown[]).length;
      if (newCount > 0) {
        console.log(`[source] ${entry.nodeId}: ${newCount} new item(s)`);
      } else {
        console.log(`[source] ${entry.nodeId}: up to date`);
      }
    } else {
      console.log(`[source] ${entry.nodeId}: refreshed`);
    }
  } else {
    console.log(`[source] ${entry.nodeId}: refreshed`);
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const item = items[idx++]!;
      await fn(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
}
