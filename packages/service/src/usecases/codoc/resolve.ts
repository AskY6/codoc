// Resolution helpers for codoc data fields.
//
// `resolveDataFields` evaluates all data fields in a codoc's AST against
// a workspace-scoped AST lookup. Uses the core DAG evaluator for
// transitive ref resolution and calls source providers for `source`
// fields.
//
// `validateDAG` rebuilds the workspace DAG and logs warnings for unknown
// targets and cycles. It never throws — validation is advisory.

import type { CodocAST, CodocPath, NodeId, ResolveResult } from "@cobook/core";
import { buildDAG, checkCycles, evaluate, parseNodeId } from "@cobook/core";
import type { StoredCodoc } from "@cobook/storage";
import type { SourceRegistry } from "@cobook/parser";

/**
 * Convert a list of stored codocs into the `Map<CodocPath, CodocAST>`
 * consumed by both `resolveDataFields` and `buildDAG`.
 */
export function toAstMap(
  rows: readonly StoredCodoc[],
): ReadonlyMap<CodocPath, CodocAST> {
  const m = new Map<CodocPath, CodocAST>();
  for (const row of rows) {
    m.set(row.codoc.path, row.codoc.ast);
  }
  return m;
}

/**
 * Resolve every data field in a single codoc against the workspace's
 * full AST set. Returns `null` when the codoc has no data fields.
 *
 * Resolution uses the core DAG evaluator:
 * 1. Build the workspace DAG from the full AST map
 * 2. Execute source providers in parallel, collecting results
 * 3. Feed static + source values into `evaluate()` which walks topo
 *    order and resolves ref chains transitively
 * 4. Project the results for the target codoc's fields
 */
export async function resolveDataFields(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  lookup: ReadonlyMap<CodocPath, CodocAST>,
  sourceProviders: SourceRegistry,
): Promise<Record<string, ResolveResult> | null> {
  if (codoc.ast.data.size === 0) return null;

  // Build DAG from the full workspace AST set.
  const dagResult = buildDAG(lookup);
  if (!dagResult.ok) {
    // DAG build failed (unknown targets). Fall back to field-level
    // resolution without the graph — static fields resolve, everything
    // else errors.
    return resolveWithoutDAG(codoc, sourceProviders);
  }

  const dag = dagResult.value;

  // Execute source providers for all source nodes in the DAG.
  const sourceValues = await executeSourceProviders(dag, sourceProviders);

  // Run the core evaluator (pure, synchronous).
  const allResults = evaluate(dag, sourceValues);

  // Project: only return results for the target codoc's fields.
  return projectForCodoc(codoc.path, codoc.ast, allResults);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function executeSourceProviders(
  dag: import("@cobook/core").DAG,
  registry: SourceRegistry,
): Promise<ReadonlyMap<NodeId, unknown>> {
  const results = new Map<NodeId, unknown>();
  const pending: Array<{ nodeId: NodeId; promise: Promise<unknown> }> = [];

  for (const [nodeId, node] of dag.nodes) {
    if (node.field.kind !== "source") continue;

    const provider = registry.get(node.field.source);
    if (!provider) continue; // evaluate() will produce an error for unseeded nodes

    pending.push({
      nodeId,
      promise: provider.execute(node.field.params).catch((e: unknown) => {
        // Return a sentinel so we can distinguish "provider returned undefined"
        // from "provider threw". The evaluate() function treats missing
        // entries as errors, so we DON'T seed the map for failures — the
        // core evaluator will produce a proper ResolveResult error.
        return PROVIDER_ERROR;
      }),
    });
  }

  const settled = await Promise.all(pending.map((p) => p.promise));
  for (let i = 0; i < pending.length; i++) {
    const value = settled[i];
    if (value !== PROVIDER_ERROR) {
      results.set(pending[i]!.nodeId, value);
    }
  }

  return results;
}

const PROVIDER_ERROR = Symbol("PROVIDER_ERROR");

function projectForCodoc(
  codocPath: CodocPath,
  ast: CodocAST,
  allResults: ReadonlyMap<NodeId, ResolveResult>,
): Record<string, ResolveResult> | null {
  if (ast.data.size === 0) return null;

  const out: Record<string, ResolveResult> = {};
  let hasAny = false;

  for (const [fieldName] of ast.data) {
    // Reconstruct the NodeId for this codoc's field.
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

/**
 * Fallback when the DAG can't be built (unknown targets). Resolves
 * each field independently: static → ready, source → call provider,
 * ref → error.
 */
async function resolveWithoutDAG(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  sourceProviders: SourceRegistry,
): Promise<Record<string, ResolveResult> | null> {
  const out: Record<string, ResolveResult> = {};
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
          error: { message: `cannot resolve ref: DAG build failed`, cause: null },
        };
        break;
      case "source": {
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

  return hasAny ? out : null;
}

// ---------------------------------------------------------------------------
// DAG validation (unchanged from slice 6)
// ---------------------------------------------------------------------------

/**
 * Rebuild the workspace DAG and log warnings. Never throws.
 *
 * Called after every `updateCodocContent` to surface structural issues
 * (unknown targets, cycles) without failing the update.
 */
export function validateDAG(
  astMap: ReadonlyMap<CodocPath, CodocAST>,
): void {
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
