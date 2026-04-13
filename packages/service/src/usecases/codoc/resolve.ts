// Resolution helpers for codoc data fields.
//
// `resolveDataFields` resolves all data fields in a codoc's AST against
// a workspace-scoped AST lookup. Resolution is 1-level deep: a ref that
// targets a static field yields the static value; a ref that targets
// another ref or a source yields `null`.
//
// `validateDAG` rebuilds the workspace DAG and logs warnings for unknown
// targets and cycles. It never throws — validation is advisory.

import type { CodocAST, CodocPath } from "@cobook/core";
import { buildDAG, checkCycles, resolveRef } from "@cobook/core";
import { parseNodeId } from "@cobook/core";
import type { StoredCodoc } from "@cobook/storage";

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
 * full AST set. Returns `null` when the codoc has no data fields or
 * every resolved value is `null`.
 *
 * Resolution rules per field kind:
 * - `static` → `field.value`
 * - `ref`    → 1-level lookup: resolve the ref to a NodeId, find the
 *              target codoc + field in the lookup map, return the target
 *              field's value only if it is `static`; otherwise `null`.
 * - `source` → `null` (no source execution engine yet)
 */
export function resolveDataFields(
  codoc: { readonly path: CodocPath; readonly ast: CodocAST },
  lookup: ReadonlyMap<CodocPath, CodocAST>,
): Record<string, unknown> | null {
  if (codoc.ast.data.size === 0) return null;

  const resolved: Record<string, unknown> = {};
  let hasValue = false;

  for (const [fieldName, field] of codoc.ast.data) {
    switch (field.kind) {
      case "static": {
        resolved[fieldName] = field.value;
        hasValue = true;
        break;
      }
      case "ref": {
        const nodeId = resolveRef(field.ref, codoc.path);
        const parsed = parseNodeId(nodeId);
        if (!parsed) {
          resolved[fieldName] = null;
          break;
        }
        const targetAst = lookup.get(parsed.codocPath);
        if (!targetAst) {
          resolved[fieldName] = null;
          break;
        }
        const targetField = targetAst.data.get(parsed.fieldName);
        if (!targetField || targetField.kind !== "static") {
          resolved[fieldName] = null;
          break;
        }
        resolved[fieldName] = targetField.value;
        hasValue = true;
        break;
      }
      case "source": {
        resolved[fieldName] = null;
        break;
      }
    }
  }

  return hasValue ? resolved : null;
}

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
