# Slice 6 Implementation Plan: $ref Resolution + DAG Validation

## Starting Point

The parser (`parseCodoc`) already populates `ast.data` with typed
`DataField` entries (static / ref / source) on every
`updateCodocContent` call. The core DAG module (`buildDAG`,
`topoSort`, `checkCycles`, `invalidate`) and the core ref module
(`parseRef`, `resolveRef`, `ResolvedField`, `ResolveResult`) are
fully implemented and tested. **No `@cobook/core` changes are
needed.** The work is entirely in `@cobook/service` (use cases +
repo) and `apps/web` (detail page).

---

## Architecture Decisions (frozen)

1. **Resolution on read, not on write.** `getCodoc` resolves `$ref`
   fields at request time by reading sibling codocs from the same
   workspace. Always fresh, no downstream invalidation needed. A
   workspace-scoped `listByWorkspace` call provides the full AST set;
   workspace codoc counts are small enough that one scan is cheap.

2. **Depth limit: 1 level.** A ref resolves to the target's static
   value. If the target is itself a ref or source, the result is
   `null`. No transitive chains. No recursive resolution.

3. **Resolution errors → `null`.** Missing codoc, missing field,
   non-static target → `null` in `resolvedData`. No error propagation
   to the client; no failure on the API call.

4. **DAG rebuilt on write for validation only.** `updateCodocContent`
   rebuilds the workspace DAG after a successful update.
   `buildDAG` errors (unknown targets) and cycle warnings are logged
   but **do not fail the update**. A codoc that references a
   not-yet-created codoc is saveable; the ref resolves to `null` until
   the target exists.

5. **DAG is ephemeral.** Not persisted. Rebuilt per request. This
   matches the roadmap: "DAG rebuild on write" is for validation,
   and "resolution on read" is a per-request operation using the
   raw AST data. A caching layer can be added later without
   changing any signatures.

6. **`resolvedData` on `CodocDetail`.** The DTO gains
   `resolvedData: Record<string, unknown> | null`. `null` when the
   codoc has zero data fields. The web uses `resolvedData` in view
   mode and client-side parsed data in edit-mode preview.

7. **No new routes.** `GET /api/codocs/:id` returns richer
   `CodocDetail`; `PUT /api/codocs/:id` returns richer `CodocDetail`.
   No new HTTP endpoints.

8. **No new stores.** The roadmap says "Stores upgraded: none new."
   Resolution uses the existing `CodocStore.listByWorkspace` for
   sibling lookup.

---

## Phase 1: Service Layer — Resolution Helper

### Step 1.1: `resolveDataFields` pure function

**File:** `packages/service/src/usecases/codoc/resolve.ts` (new)

A service-layer helper that resolves all data fields in a codoc's AST
against a workspace-scoped AST lookup. Uses `resolveRef` and
`parseNodeId` from `@cobook/core`.

```ts
import type { Codoc, CodocAST, CodocPath } from "@cobook/core";
import { resolveRef } from "@cobook/core/codoc/ref";
import { parseNodeId } from "@cobook/core/dag/node-id";

export function resolveDataFields(
  codoc: Pick<Codoc, "path" | "ast">,
  lookup: ReadonlyMap<CodocPath, CodocAST>,
): Record<string, unknown> | null
```

**Logic per data field:**

| `DataField.kind` | Resolution |
|---|---|
| `static` | `field.value` |
| `ref` | `resolveRef(field.ref, codoc.path)` → `parseNodeId` → lookup target AST → target field → if `static`, use `value`; else `null` |
| `source` | `null` (deferred — no source execution engine yet) |

Returns `null` when `ast.data.size === 0` or when every resolved value
is `null`.

**Testable:** Unit test with synthetic `Codoc` + `Map<CodocPath, CodocAST>`:
- static value → passes through
- ref to existing static field → resolves
- ref to missing codoc → `null`
- ref to missing field → `null`
- ref to another ref (depth > 1) → `null`
- ref to source → `null`
- empty data map → `null`

### Step 1.2: `toAstMap` helper

**File:** same file (`resolve.ts`)

```ts
import type { StoredCodoc } from "@cobook/storage";

export function toAstMap(
  rows: readonly StoredCodoc[],
): ReadonlyMap<CodocPath, CodocAST>
```

Converts the raw storage list into the `Map<CodocPath, CodocAST>` that
`resolveDataFields` and `buildDAG` both consume.

---

## Phase 2: Repo — Resolution-Aware Detail Read

### Step 2.1: Upgrade `toDetail` to accept `resolvedData`

**File:** `packages/service/src/repo/codoc.ts`

```ts
function toDetail(
  row: StoredCodoc,
  resolvedData?: Record<string, unknown> | null,
): CodocDetail {
  return {
    id: row.codoc.id as string,
    path: row.codoc.path as string,
    title: row.codoc.ast.meta.title,
    content: row.codoc.content,
    updatedAt: row.updatedAt as number,
    rev: row.rev as string,
    resolvedData: resolvedData ?? null,
  };
}
```

### Step 2.2: Add `getDetailResolved` to `codocRepo`

**File:** `packages/service/src/repo/codoc.ts`

New method that reads a codoc, fetches all workspace siblings,
resolves data fields, and returns `CodocDetail` with `resolvedData`.

```ts
async getDetailResolved(
  ctx: ServiceCtx,
  id: CodocId,
): Promise<Result<CodocDetail, CodocNotFound>> {
  const r = await ctx.storage.codocs.get(ctx.storageCtx, id);
  if (!r.ok) return err({ kind: "codoc-not-found", id });

  const siblings = await ctx.storage.codocs.listByWorkspace(
    ctx.storageCtx,
    r.value.workspaceId,
  );
  const astMap = toAstMap(siblings);
  const resolved = resolveDataFields(r.value.codoc, astMap);
  return ok(toDetail(r.value, resolved));
}
```

### Step 2.3: Add `listAstsByWorkspace` to `codocRepo`

New method for the DAG validation path (used by
`updateCodocContent`).

```ts
async listAstsByWorkspace(
  ctx: ServiceCtx,
  workspaceId: WorkspaceId,
): Promise<ReadonlyMap<CodocPath, CodocAST>> {
  const rows = await ctx.storage.codocs.listByWorkspace(
    ctx.storageCtx,
    workspaceId,
  );
  return toAstMap(rows);
}
```

### Step 2.4: Backfill `resolvedData: null` on existing `toDetail` calls

Every path that returns `CodocDetail` without resolution
(`getDetail`, `update`) must now include `resolvedData: null` so the
DTO shape is always complete. Update `toDetail` default:

```ts
function toDetail(row: StoredCodoc, resolvedData: Record<string, unknown> | null = null): CodocDetail
```

---

## Phase 3: Use Cases — Resolution + DAG Validation

### Step 3.1: Upgrade `getCodoc` to resolve refs

**File:** `packages/service/src/usecases/codoc/get-codoc.ts`

Replace the single-line delegation:

```ts
// Before
return codocRepo.getDetail(ctx, id);

// After
return codocRepo.getDetailResolved(ctx, id);
```

### Step 3.2: Upgrade `updateCodocContent` — DAG validation + resolved return

**File:** `packages/service/src/usecases/codoc/update-codoc-content.ts`

After the successful `codocRepo.update()`, add:

1. Read workspace id from the stored codoc (repo already fetched it
   in step 1 of the use case via `codocRepo.getCodoc`). Since
   `getCodoc` returns the core `Codoc` without `workspaceId`, we
   need to change to fetching from storage directly, or add a
   method to get the workspaceId. **Chosen approach:** add
   `getWorkspaceId(ctx, codocId)` to codocRepo (reads from storage,
   returns `WorkspaceId`).

2. Fetch all workspace ASTs via `codocRepo.listAstsByWorkspace`.

3. Call `buildDAG(astMap)`:
   - On `ok`: call `checkCycles(dag)` — log if cyclic.
   - On `err`: log unknown-target errors.
   - Neither case fails the update.

4. Call `resolveDataFields` on the updated codoc and return the
   result in the `CodocDetail`.

**Updated return path:** The repo's `update` method returns a
`CodocDetail` without resolution. The use case then attaches
`resolvedData` before returning.

**Revised flow:**

```ts
async function updateCodocContent(ctx, input) {
  // 1. Fetch full stored codoc (need workspaceId + existing ast)
  const stored = await ctx.storage.codocs.get(ctx.storageCtx, input.id);
  if (!stored.ok) return err({ kind: "codoc-not-found", id: input.id });

  // 2. Re-parse AST
  const parsed = parseCodoc(input.content);
  if (!parsed.ok) return err({ kind: "codoc-parse-failure", ... });

  // 3. Build next codoc + update with optimistic concurrency
  const next: Codoc = { ...stored.value.codoc, content: input.content, ast: parsed.value };
  const updated = await codocRepo.update(ctx, { codoc: next, expectedRev: input.expectedRev });
  if (!updated.ok) return updated;

  // 4. DAG validation (fire-and-forget logging)
  const astMap = await codocRepo.listAstsByWorkspace(ctx, stored.value.workspaceId);
  validateDAG(astMap);   // logs warnings, never throws

  // 5. Resolve data for the response
  const resolved = resolveDataFields(next, astMap);
  return ok({ ...updated.value, resolvedData: resolved });
}
```

### Step 3.3: `validateDAG` helper

**File:** `packages/service/src/usecases/codoc/resolve.ts` (same file)

```ts
import { buildDAG, checkCycles } from "@cobook/core";

export function validateDAG(
  astMap: ReadonlyMap<CodocPath, CodocAST>,
): void {
  const dagResult = buildDAG(astMap);
  if (!dagResult.ok) {
    for (const e of dagResult.error) {
      console.warn(`[codoc/dag] unknown-target: ${e.fromCodoc}#data.${e.fromField} → ${e.target}`);
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
```

---

## Phase 4: DTO + Type Changes

### Step 4.1: Add `resolvedData` to service `CodocDetail`

**File:** `packages/service/src/types/codoc.ts`

```ts
export interface CodocDetail {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly content: string;
  readonly updatedAt: number;
  readonly rev: string;
  /** Resolved data fields. null when the codoc has no data block. */
  readonly resolvedData: Record<string, unknown> | null;
}
```

### Step 4.2: Add `resolvedData` to web `CodocDetail`

**File:** `apps/web/src/types.ts`

```ts
export interface CodocDetail {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  readonly content: string;
  readonly updatedAt: number;
  readonly rev: string;
  readonly resolvedData: Record<string, unknown> | null;
}
```

No API client changes — `getCodoc` and `updateCodocContent` already
return `CodocDetail`, so the new field flows through automatically.

---

## Phase 5: Web — Use Resolved Data

### Step 5.1: Upgrade `CodocDetailPage` view mode

**File:** `apps/web/src/pages/codoc-detail.tsx`

In view mode, prefer `resolvedData` from the server over client-side
parsed data:

```tsx
// Current (line 203-206):
<MdxRenderer
  source={parsed.body}
  data={parsed.data}
  components={codocComponents}
/>

// Updated:
<MdxRenderer
  source={parsed.body}
  data={codoc.resolvedData ?? parsed.data}
  components={codocComponents}
/>
```

**Rationale:** `codoc.resolvedData` comes from the API and includes
resolved `$ref` values. `parsed.data` is client-side best-effort
(skips refs). In view mode we always have `codoc` from the query,
so `resolvedData` is available. The client-side parse remains for
(a) extracting `body` (the MDX view source) and (b) fallback when
`resolvedData` is null.

### Step 5.2: Handle `resolvedData` after save in edit mode

After a successful save, `updateMutation.onSuccess` sets
`queryClient.setQueryData` with the returned `CodocDetail`. The
new `resolvedData` is included on that object, so switching from
edit → view mode after save automatically uses the fresh resolved
data. No additional wiring needed.

---

## Phase 6: Documentation + Cleanup

### Step 6.1: Update `usecases/codoc/AGENTS.md`

Replace the "Deferred: nodeState and the dag" section with the
locked-in conventions:

- `resolvedData` on `CodocDetail` is the wire-safe projection.
  Contains resolved scalar values for all data fields: static
  values pass through, refs resolve to 1-level-deep static targets
  or null, sources are null.
- DAG validation runs on every `updateCodocContent` via `buildDAG`
  + `checkCycles`. Errors logged, never fail the update.
- Resolution is per-request (on read). No cached or persisted DAG.

### Step 6.2: Update `docs/slices.md`

Mark slice 6 as DONE with actual scope, conventions locked in,
and deferred items.

### Step 6.3: New AGENTS.md for resolve module

**File:** `packages/service/src/usecases/codoc/resolve.ts` does not
warrant its own directory, so document `resolveDataFields` and
`validateDAG` in the updated `usecases/codoc/AGENTS.md`.

---

## Dependency Graph

```
Phase 1 (resolve helper)
  └─ Phase 2 (repo: getDetailResolved, listAstsByWorkspace)
       └─ Phase 3 (use cases: getCodoc + updateCodocContent)
            ├─ Phase 4 (DTO changes) ← can parallel with Phase 3
            └─ Phase 5 (web: use resolvedData)
                 └─ Phase 6 (docs)
```

Phase 4 (DTO changes) is a prerequisite for both Phase 3 and
Phase 5, so in practice:

```
Phase 1 → Phase 4 → Phase 2 → Phase 3 → Phase 5 → Phase 6
```

## Suggested Session Splits

| Session | Phases | Verification |
|---|---|---|
| A | 1–4 | typecheck all packages + unit tests for `resolveDataFields` |
| B | 3 (DAG validation) | `updateCodocContent` logs DAG warnings for broken refs |
| C | 5 | browser: view a codoc with `$ref` fields, confirm resolved values render |
| D | 6 | docs updated, `/verify-fix` browser run |

## Verification Scenario

From `docs/slices.md`:

1. Open a workspace with interconnected codocs (e.g. perf-review
   set: `reviews/alice` with `score_business: 4` as static,
   `calibration/q2-2026` with `alice_score: { $ref: "./reviews/alice#data.score_business" }`).
2. Open the calibration codoc → view mode shows `4` (not `0` or
   empty).
3. Edit the review codoc, change `score_business: 5`, save.
4. Re-open calibration → view mode shows `5`.
5. Create a codoc with a ref to a non-existent target → view mode
   shows the field as `null` / absent, no error.

## Files Changed (Summary)

| File | Change |
|---|---|
| `packages/service/src/usecases/codoc/resolve.ts` | **new** — `resolveDataFields`, `toAstMap`, `validateDAG` |
| `packages/service/src/types/codoc.ts` | add `resolvedData` to `CodocDetail` |
| `packages/service/src/repo/codoc.ts` | add `getDetailResolved`, `listAstsByWorkspace`; update `toDetail` signature |
| `packages/service/src/usecases/codoc/get-codoc.ts` | delegate to `getDetailResolved` |
| `packages/service/src/usecases/codoc/update-codoc-content.ts` | add DAG validation + resolvedData on response |
| `apps/web/src/types.ts` | add `resolvedData` to `CodocDetail` |
| `apps/web/src/pages/codoc-detail.tsx` | use `codoc.resolvedData ?? parsed.data` in view mode |
| `packages/service/src/usecases/codoc/AGENTS.md` | replace deferred section with locked-in conventions |
| `docs/slices.md` | mark slice 6 done (after implementation) |

## Legacy Reference Files

- `legacy/packages/core/src/ref/ref-parser.ts` — `parseRef` (simpler string-based)
- `legacy/packages/core/src/ref/ref-normalizer.ts` — `normalizeRef` (relative path resolution)
- `legacy/packages/core/src/dag/dag.ts` — `buildDAG` (two-pass, no error collection)
- `legacy/packages/core/src/parser/codoc-parser.ts` — `classifyDataField` (static/ref/source ADT)
