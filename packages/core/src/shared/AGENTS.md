# shared/

Two primitives every other subtree depends on. Intentionally tiny.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — global invariants.

## `Brand<T, B>` — nominal types on primitives

`branded.ts`

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
```

Purpose: distinguish otherwise-interchangeable primitives at compile time. `CodocId` and `WorkspaceId` are both `string` at runtime, but the type system refuses to mix them.

### How IDs are defined in each subtree

```ts
export type CodocId = Brand<string, "CodocId">;
export const CodocId = (s: string): CodocId => s as CodocId;
```

- Type and value share the same name — one `import { CodocId }` gives you both the type and the smart constructor.
- Smart constructors are **thin and trust the caller**. Validation (length, charset, format) belongs to parsers at the system boundary, not here.

## `Result<T, E>` — explicit success/failure ADT

`result.ts`

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

ok(value)     // Result<T, never>
err(error)    // Result<never, E>
isOk(r)       // type guard
isErr(r)      // type guard
```

### Rules

- **Every pure core function that can fail returns `Result`, never throws.** Callers are forced to handle both branches.
- **`E` is always a domain ADT**, not `string` or `Error`. Example shapes live next to the function that produces them — see `codoc/ref.ts` (`ParseRefError`) and `dag/build.ts` (`BuildError`).
- **Batch errors when it makes sense.** `buildDAG` returns `Result<DAG, readonly BuildError[]>` and collects every issue in one pass rather than short-circuiting on the first.
- **Do not wrap infallible functions** in `Result` "for consistency". If a function cannot fail, its return type should reflect that.

## What does NOT go here

- Logging, telemetry, clock, uuid — all of those are IO, and core has none.
- Generic utility helpers (`pick`, `groupBy`, etc.) — add them next to their only call site; revisit only if truly reused across subtrees.
- Error base classes — we use ADTs, not exception hierarchies.
