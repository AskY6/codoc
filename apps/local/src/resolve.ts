// Local resolve — mirrors packages/service/src/usecases/codoc/resolve.ts
// but without the @cobook/storage dependency. Works directly with
// Map<CodocPath, CodocAST> from the local workspace.

import type { CodocAST, CodocPath, DAG, NodeId, ResolveResult } from "@cobook/core";
import { buildDAG, checkCycles, evaluate } from "@cobook/core";
import type { SourceRegistry } from "@cobook/parser";

/**
 * Resolve every data field in a single codoc against the workspace's
 * full AST map.
 */
export async function resolveDataFields(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  lookup: ReadonlyMap<CodocPath, CodocAST>,
  sourceProviders: SourceRegistry,
): Promise<Record<string, ResolveResult> | null> {
  if (codoc.ast.data.size === 0) return null;

  const dagResult = buildDAG(lookup);
  if (!dagResult.ok) {
    return resolveWithoutDAG(codoc, sourceProviders);
  }

  const dag = dagResult.value;
  const sourceValues = await executeSourceProviders(dag, sourceProviders);
  const allResults = evaluate(dag, sourceValues);

  return projectForCodoc(codoc.path, codoc.ast, allResults);
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

async function executeSourceProviders(
  dag: DAG,
  registry: SourceRegistry,
): Promise<ReadonlyMap<NodeId, unknown>> {
  const results = new Map<NodeId, unknown>();
  const pending: Array<{ nodeId: NodeId; promise: Promise<unknown> }> = [];

  for (const [nodeId, node] of dag.nodes) {
    if (node.field.kind !== "source") continue;

    const provider = registry.get(node.field.source);
    if (!provider) continue;

    pending.push({
      nodeId,
      promise: provider.execute(node.field.params).catch(() => PROVIDER_ERROR),
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
          error: { message: "cannot resolve ref: DAG build failed", cause: null },
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
