// source-scheduler — generic per-source-field background refresh.
//
// Scans workspace for $source fields with `interval`, checks timing
// against .source-state.json, and refreshes when due. Merge strategy
// is provider-owned: providers with a `merge` method get merge semantics,
// all others use replace.

import type { EventEmitter } from "node:events";
import type { CodocPath, FieldName, NodeId } from "@cobook/core";
import type { SourceProvider } from "@cobook/parser";
import type { Workspace } from "./workspace.js";
import {
  readSourceState,
  type SourceStateMap,
} from "./source-state.js";
import { updateSourceFieldCache } from "./workspace-service.js";

const CHECK_INTERVAL_MS = 60 * 1000; // check every 1 minute

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SourceScheduler {
  /** Stop the scheduler. Safe to call multiple times. */
  stop(): void;
  /** Resolves when the first tick completes (all due sources refreshed). */
  readonly ready: Promise<void>;
}

/**
 * Start a generic source-field refresh scheduler for a workspace.
 * Scans for all $source fields with `interval`, refreshes when due.
 */
export function startSourceScheduler(ws: Workspace, updates?: EventEmitter): SourceScheduler {
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

    for (const entry of due) {
      if (stopped) return;
      try {
        await refreshSource(ws, entry, state, updates);
      } catch (e) {
        console.warn(
          `[source] failed to refresh ${entry.nodeId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
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
// Refresh a single source
// ---------------------------------------------------------------------------

async function refreshSource(
  ws: Workspace,
  entry: PeriodicSource,
  state: SourceStateMap,
  updates?: EventEmitter,
): Promise<void> {
  const raw = await entry.provider.execute(entry.params);

  // Merge strategy: use provider merge if available, otherwise replace.
  const existing = state[entry.nodeId]?.cachedValue;
  const merged = entry.provider.merge
    ? entry.provider.merge(existing, raw)
    : raw;

  // Delegate to service layer.
  await updateSourceFieldCache(
    { ws, updates },
    entry.codocPath,
    entry.fieldName,
    merged,
    new Date().toISOString(),
  );

  // Log summary.
  if (entry.provider.merge && Array.isArray(merged) && Array.isArray(existing)) {
    const newCount = merged.length - existing.length;
    if (newCount > 0) {
      console.log(`[source] ${entry.nodeId}: ${newCount} new item(s)`);
    } else {
      console.log(`[source] ${entry.nodeId}: up to date`);
    }
  } else {
    console.log(`[source] ${entry.nodeId}: refreshed`);
  }
}

