// Local resolve — mirrors packages/service/src/usecases/codoc/resolve.ts
// but without the @cobook/storage dependency. Works directly with
// Map<CodocPath, CodocAST> from the local workspace.

import type { CodocAST, CodocPath, DAG, NodeId, ResolveResult } from "@cobook/core";
import { buildDAG, checkCycles, evaluate } from "@cobook/core";
import type { SourceRegistry } from "@cobook/parser";
import type { SourceStateEntry, SourceStateMap } from "../sources/state.js";

/**
 * Resolve output — data results plus any source state entries that need
 * persisting (from lazy TTL revalidations).
 */
export interface ResolveOutput {
  readonly data: Record<string, ResolveResult> | null;
  readonly stateUpdates: Record<string, SourceStateEntry>;
}

/**
 * Resolve every data field in a single codoc against the workspace's
 * full AST map.
 */
export async function resolveDataFields(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  lookup: ReadonlyMap<CodocPath, CodocAST>,
  sourceProviders: SourceRegistry,
  sourceState?: SourceStateMap,
): Promise<ResolveOutput> {
  if (codoc.ast.data.size === 0) return { data: null, stateUpdates: {} };

  const dagResult = buildDAG(lookup);
  if (!dagResult.ok) {
    return resolveWithoutDAG(codoc, sourceProviders, sourceState);
  }

  const dag = dagResult.value;
  const { values: sourceValues, stateUpdates } = await executeSourceProviders(dag, sourceProviders, sourceState);
  const allResults = evaluate(dag, sourceValues);

  return { data: projectForCodoc(codoc.path, codoc.ast, allResults), stateUpdates };
}

/**
 * Rebuild the workspace DAG and log warnings. Never throws.
 */
export function validateDAG(astMap: ReadonlyMap<CodocPath, CodocAST>): void {
  const dagResult = buildDAG(astMap);
  if (!dagResult.ok) {
    for (const e of dagResult.error) {
      console.warn(
        `[codoc/dag] unknown-target: ${e.fromCodoc}#data.${e.fromField} → ${e.target}`,
      );
    }
    return;
  }
  const cycleCheck = checkCycles(dagResult.value);
  if (cycleCheck.kind === "cyclic") {
    for (const c of cycleCheck.cycles) {
      console.warn(`[codoc/dag] cycle: ${c.path.join(" → ")}`);
    }
  }
}

/**
 * Build a map from CodocPath → CodocAST suitable for DAG operations.
 */
export function toAstMap(
  entries: Iterable<readonly [CodocPath, CodocAST]>,
): ReadonlyMap<CodocPath, CodocAST> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const PROVIDER_ERROR = Symbol("PROVIDER_ERROR");

interface SourceProviderResult {
  values: ReadonlyMap<NodeId, unknown>;
  stateUpdates: Record<string, SourceStateEntry>;
}

function isTtlValid(nodeId: string, ttl: number, state?: SourceStateMap): boolean {
  const entry = state?.[nodeId];
  if (!entry?.lastFetchedAt || entry.cachedValue === undefined) return false;
  const elapsed = Date.now() - new Date(entry.lastFetchedAt).getTime();
  return elapsed < ttl * 60 * 1000;
}

async function executeSourceProviders(
  dag: DAG,
  registry: SourceRegistry,
  sourceState?: SourceStateMap,
): Promise<SourceProviderResult> {
  const results = new Map<NodeId, unknown>();
  const stateUpdates: Record<string, SourceStateEntry> = {};
  const pending: Array<{ nodeId: NodeId; isLazy: boolean; promise: Promise<unknown> }> = [];

  for (const [nodeId, node] of dag.nodes) {
    if (node.field.kind !== "source") continue;

    // Periodic sources: use cached value from state file instead of executing.
    // The scheduler is responsible for refreshing these at the right time.
    if (node.field.fetch.kind === "periodic" && sourceState?.[nodeId]?.cachedValue !== undefined) {
      results.set(nodeId, sourceState[nodeId]!.cachedValue);
      continue;
    }

    // Lazy sources: use cached value if TTL hasn't expired.
    if (node.field.fetch.kind === "lazy" && isTtlValid(nodeId, node.field.fetch.ttl, sourceState)) {
      results.set(nodeId, sourceState![nodeId]!.cachedValue);
      continue;
    }

    const provider = registry.get(node.field.source);
    if (!provider) continue;

    pending.push({
      nodeId,
      isLazy: node.field.fetch.kind === "lazy",
      promise: provider.execute(node.field.params).catch(() => PROVIDER_ERROR),
    });
  }

  const settled = await Promise.all(pending.map((p) => p.promise));
  for (let i = 0; i < pending.length; i++) {
    const value = settled[i];
    if (value !== PROVIDER_ERROR) {
      results.set(pending[i]!.nodeId, value);
      // Lazy sources: record state update for persistence.
      if (pending[i]!.isLazy) {
        stateUpdates[pending[i]!.nodeId] = {
          lastFetchedAt: new Date().toISOString(),
          cachedValue: value,
        };
      }
    }
  }

  return { values: results, stateUpdates };
}

function projectForCodoc(
  codocPath: CodocPath,
  ast: CodocAST,
  allResults: ReadonlyMap<NodeId, ResolveResult>,
): Record<string, ResolveResult> | null {
  if (ast.data.size === 0) return null;

  const out: Record<string, ResolveResult> = {};
  let hasAny = false;

  for (const [fieldName] of ast.data) {
    const nodeId = `${codocPath}#data.${fieldName}` as NodeId;
    const result = allResults.get(nodeId);
    if (result) {
      out[fieldName] = result;
      hasAny = true;
    } else {
      out[fieldName] = {
        kind: "error",
        error: { message: `no evaluation result for "${nodeId}"`, cause: null },
      };
      hasAny = true;
    }
  }

  return hasAny ? out : null;
}

async function resolveWithoutDAG(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  sourceProviders: SourceRegistry,
  sourceState?: SourceStateMap,
): Promise<ResolveOutput> {
  const out: Record<string, ResolveResult> = {};
  const stateUpdates: Record<string, SourceStateEntry> = {};
  let hasAny = false;

  for (const [fieldName, field] of codoc.ast.data) {
    hasAny = true;
    switch (field.kind) {
      case "static":
        out[fieldName] = { kind: "ready", value: field.value };
        break;
      case "ref":
        out[fieldName] = {
          kind: "error",
          error: { message: "cannot resolve ref: DAG build failed", cause: null },
        };
        break;
      case "source": {
        const nodeId = `${codoc.path}#data.${fieldName}`;

        // Periodic sources: use cached value if available.
        if (field.fetch.kind === "periodic" && sourceState?.[nodeId]?.cachedValue !== undefined) {
          out[fieldName] = { kind: "ready", value: sourceState[nodeId]!.cachedValue };
          break;
        }

        // Lazy sources: use cached value if TTL hasn't expired.
        if (field.fetch.kind === "lazy" && isTtlValid(nodeId, field.fetch.ttl, sourceState)) {
          out[fieldName] = { kind: "ready", value: sourceState![nodeId]!.cachedValue };
          break;
        }

        const provider = sourceProviders.get(field.source);
        if (!provider) {
          out[fieldName] = {
            kind: "error",
            error: { message: `unknown source provider: "${field.source}"`, cause: null },
          };
          break;
        }
        try {
          const value = await provider.execute(field.params);
          out[fieldName] = { kind: "ready", value };
          // Lazy sources: record state update for persistence.
          if (field.fetch.kind === "lazy") {
            stateUpdates[nodeId] = {
              lastFetchedAt: new Date().toISOString(),
              cachedValue: value,
            };
          }
        } catch (e: unknown) {
          out[fieldName] = {
            kind: "error",
            error: {
              message: `source provider "${field.source}" failed: ${e instanceof Error ? e.message : String(e)}`,
              cause: null,
            },
          };
        }
        break;
      }
    }
  }

  return { data: hasAny ? out : null, stateUpdates };
}
