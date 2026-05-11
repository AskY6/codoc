// workspace-service — shared domain operations for workspace mutations.
//
// Both MCP tools and REST API routes are thin facades over these functions.
// This module owns the "read state → mutate → persist → recompile → notify" cycle.

import type { EventEmitter } from "node:events";
import type { CodocPath, FieldName, NodeId, ResolveResult } from "@cobook/core";
import { CodocPath as mkCodocPath, FieldName as mkFieldName } from "@cobook/core";
import type { Workspace, WriteResult } from "./workspace.js";
import { writeCodoc, compileOne } from "./workspace.js";
import { patchDataField, patchSourceFieldParam } from "./patch.js";
import {
  readSourceState,
  writeSourceState,
  withEntry,
} from "./source-state.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ServiceResult =
  | { readonly ok: true; readonly message: string; readonly writeResult?: WriteResult }
  | { readonly ok: false; readonly error: string };

/** Context passed to all service functions. */
export interface ServiceContext {
  readonly ws: Workspace;
  readonly updates?: EventEmitter | undefined;
}

// ---------------------------------------------------------------------------
// updateSourceFieldCache
// ---------------------------------------------------------------------------

/**
 * Update the cached value of a $source field.
 *
 * Writes to `.source-state.json`, updates in-memory resolved data, recompiles
 * the codoc, and emits a "codoc-updated" event. Does NOT touch the `.codoc`
 * source file — the $source declaration is preserved.
 *
 * @param lastFetchedAt — override for the timestamp. If omitted, preserves the
 *   existing timestamp (useful for manual updates via agent); pass
 *   `new Date().toISOString()` for scheduler-driven refreshes.
 */
export async function updateSourceFieldCache(
  ctx: ServiceContext,
  codocPath: CodocPath,
  fieldName: FieldName,
  value: unknown,
  lastFetchedAt?: string,
): Promise<ServiceResult> {
  const { ws, updates } = ctx;
  const codoc = ws.codocs.get(codocPath);
  if (!codoc) {
    return { ok: false, error: `codoc not found at "${codocPath}"` };
  }

  const fieldDef = codoc.ast.data.get(fieldName);
  if (!fieldDef || fieldDef.kind !== "source") {
    return { ok: false, error: `"${String(fieldName)}" is not a $source field in "${codocPath}"` };
  }

  const nodeId = `${codocPath}#data.${String(fieldName)}` as NodeId;
  const state = await readSourceState(ws.sourceDir);
  const existing = state[nodeId];

  const newState = withEntry(state, nodeId, {
    ...existing,
    lastFetchedAt: lastFetchedAt ?? existing?.lastFetchedAt ?? new Date().toISOString(),
    cachedValue: value,
  });
  await writeSourceState(ws.sourceDir, newState);

  // Update in-memory resolved data + recompile.
  const updated = {
    ...codoc,
    resolvedData: {
      ...codoc.resolvedData,
      [String(fieldName)]: { kind: "ready" as const, value } satisfies ResolveResult,
    },
  };
  ws.codocs.set(codocPath, updated);
  await compileOne(ws, updated);
  updates?.emit("update", { kind: "codoc-updated", codocPath });

  return { ok: true, message: `Updated cached value for source field "${String(fieldName)}" in ${codocPath} (source declaration preserved)` };
}

// ---------------------------------------------------------------------------
// updateDataField
// ---------------------------------------------------------------------------

/**
 * Update a single data field in a codoc. Routes to the correct strategy:
 * - $source fields → updateSourceFieldCache (cache only, declaration preserved)
 * - static fields  → patchDataField + writeCodoc (YAML frontmatter rewrite)
 */
export async function updateDataField(
  ctx: ServiceContext,
  codocPath: CodocPath,
  fieldName: FieldName,
  value: unknown,
): Promise<ServiceResult> {
  const { ws, updates } = ctx;
  const codoc = ws.codocs.get(codocPath);
  if (!codoc) {
    return { ok: false, error: `codoc not found at "${codocPath}"` };
  }

  const fieldDef = codoc.ast.data.get(fieldName);

  // Source field → delegate to cache update.
  if (fieldDef && fieldDef.kind === "source") {
    return updateSourceFieldCache(ctx, codocPath, fieldName, value);
  }

  // Static / ref / new field → patch YAML frontmatter.
  const patched = patchDataField(codoc.content, String(fieldName), value);
  if (!patched.ok) {
    return { ok: false, error: patched.error };
  }

  const writeResult = await writeCodoc(ws, codocPath, patched.value);
  if (writeResult.ok) {
    updates?.emit("update", { kind: "codoc-updated", codocPath });
  }

  return writeResult.ok
    ? { ok: true, message: `Updated field "${String(fieldName)}" in ${codocPath}`, writeResult }
    : { ok: false, error: writeResult.diagnostics.map((d) => d.message).join("; ") };
}

// ---------------------------------------------------------------------------
// updateArticleState
// ---------------------------------------------------------------------------

/**
 * Patch a single article's user state (readAt, starred) within a source field
 * whose cached value is an array.
 *
 * This is a convenience wrapper over updateSourceFieldCache — it clones the
 * cached array, applies the patch at `articleIndex`, and writes back.
 */
export async function updateArticleState(
  ctx: ServiceContext,
  codocPath: CodocPath,
  fieldName: FieldName,
  articleIndex: number,
  patch: { readAt?: string | null; starred?: boolean },
): Promise<ServiceResult> {
  const { ws } = ctx;
  const codoc = ws.codocs.get(codocPath);
  if (!codoc) {
    return { ok: false, error: `codoc not found at "${codocPath}"` };
  }

  const fieldDef = codoc.ast.data.get(fieldName);
  if (!fieldDef || fieldDef.kind !== "source") {
    return { ok: false, error: `"${String(fieldName)}" is not a $source field in "${codocPath}"` };
  }

  // Read current cached value.
  const resolved = codoc.resolvedData?.[String(fieldName)];
  const cached = resolved?.kind === "ready" ? resolved.value : undefined;
  if (!Array.isArray(cached)) {
    return { ok: false, error: `cached value for "${String(fieldName)}" is not an array` };
  }

  if (articleIndex < 0 || articleIndex >= cached.length) {
    return { ok: false, error: `article index ${articleIndex} out of range (0..${cached.length - 1})` };
  }

  // Clone and patch.
  const updated = cached.map((item: Record<string, unknown>, i: number) =>
    i === articleIndex ? { ...item, ...patch } : item,
  );

  return updateSourceFieldCache(ctx, codocPath, fieldName, updated);
}

// ---------------------------------------------------------------------------
// updateSourceFieldParam
// ---------------------------------------------------------------------------

/**
 * Patch a single param within a $source data field's YAML declaration.
 * This rewrites the .codoc file (unlike updateSourceFieldCache which only
 * touches the runtime cache).
 *
 * Use for: changing the url, interval, or other provider-specific params.
 */
export async function updateSourceFieldParam(
  ctx: ServiceContext,
  codocPath: CodocPath,
  fieldName: FieldName,
  param: string,
  value: unknown,
): Promise<ServiceResult> {
  const { ws, updates } = ctx;
  const codoc = ws.codocs.get(codocPath);
  if (!codoc) {
    return { ok: false, error: `codoc not found at "${codocPath}"` };
  }

  const patched = patchSourceFieldParam(codoc.content, String(fieldName), param, value);
  if (!patched.ok) {
    return { ok: false, error: patched.error };
  }

  const writeResult = await writeCodoc(ws, codocPath, patched.value);
  if (writeResult.ok) {
    updates?.emit("update", { kind: "codoc-updated", codocPath });
  }

  return writeResult.ok
    ? { ok: true, message: `Updated param "${param}" in source field "${String(fieldName)}" of ${codocPath}` }
    : { ok: false, error: writeResult.diagnostics.map((d) => d.message).join("; ") };
}
