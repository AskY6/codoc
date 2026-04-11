# codoc/

Structural definition of the **minimum knowledge unit**. The innermost layer of core — depends on nothing except `shared/`.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — global invariants (import direction, no tenancy, no row metadata, etc.). Those are not repeated here.

## Mental model

A **Codoc** is a parsed document with three blocks:

```
Codoc
├── meta    — title, description, tags, field schemas
├── data    — named fields (static value | ref to another codoc | source call)
└── view    — presentation (mdx body | empty)
```

Raw YAML / MDX text never flows through this layer. Parsing happens at the boundary; what reaches `codoc/` is **already an AST**.

## IDs (`ids.ts`)

| ID | Encoding | Notes |
|---|---|---|
| `CodocId` | opaque string | Stable identity, assigned by storage. |
| `CodocPath` | workspace-relative posix path, e.g. `notes/meeting.codoc` | The *addressable* name of a codoc. |
| `FieldName` | leaf name under `data`, e.g. `summary` | |
| `NodeId` | `<codocPath>#data.<fieldName>` | **Lives here, not in `dag/`.** A node *is* a field inside a codoc; `dag/` only consumes this identity. |

All four are `Brand<string, "...">` with thin smart constructors that trust the caller — validation is the boundary parser's job. See [`../shared/AGENTS.md`](../shared/AGENTS.md).

## Entities and ADTs

### `Codoc` (`codoc.ts`)

```ts
interface Codoc {
  id: CodocId;
  path: CodocPath;
  content: string;   // source form, for UI / agent edits
  ast: CodocAST;     // parsed form, for pure core logic
}
```

**Invariant:** `ast` is required. A half-parsed Codoc is not a Codoc — parse failures produce an error at the boundary, never an entity with a missing `ast`.

### `CodocAST` (`ast.ts`)

```ts
interface CodocAST {
  meta: CodocMeta;
  data: ReadonlyMap<FieldName, DataField>;
  view: View;
}
```

### `CodocMeta` (`meta.ts`)

```ts
interface CodocMeta {
  title: string | null;
  description: string | null;
  tags: readonly string[];
  schema: ReadonlyMap<FieldName, FieldSchema>;
}
```

Absent optional values use `null` / empty collection. Callers should never have to disambiguate `undefined` vs "empty".

### `DataField` (`data.ts`) — 3-variant ADT

```ts
type DataField =
  | { kind: "static"; value: unknown }
  | { kind: "ref"; ref: Ref }
  | { kind: "source"; source: string; params: Record<string, unknown> };
```

Illegal combinations (e.g. a static value carrying a ref) are unrepresentable. When adding a variant, add it here — do not smuggle it through `kind: "source"` with magic `source` strings.

### `View` (`view.ts`)

Currently `{ kind: "mdx"; source: string } | { kind: "empty" }`. Additional variants (`stack`, `grid`, `tabs`, …) can be added without breaking existing consumers.

### `ResolveResult` / `ResolvedField` (`resolved.ts`)

```ts
type ResolveResult =
  | { kind: "ready"; value: unknown }
  | { kind: "error"; error: ResolveError };

interface ResolvedField {
  codocId: CodocId;
  nodeId: NodeId;
  result: ResolveResult;
}
```

`ResolveError` is a recursive shape (`message` + `cause: ResolveError | null`) so the resolver can record upstream failures without pulling in an exception type.

**No surrogate id, no `workspaceId`, no timestamps on `ResolvedField`** — those are storage concerns. See the root `AGENTS.md`.

## Ref — the one non-trivial pure function (`ref.ts`)

A `Ref` is a typed pointer from one codoc field to another:

```ts
interface Ref {
  target: RefTarget;   // relative "./other.codoc" | absolute "notes/x.codoc"
  field: FieldName;    // the leaf under the target's data block
}
```

### Wire format

```
<path>#data.<fieldName>
```

Example: `./other.codoc#data.summary`.

### `parseRef(input)` → `Result<Ref, ParseRefError>`

Possible errors: `missing-hash`, `empty-path`, `empty-field`, `non-data-field`. Only `data.*` fields are referenceable for now.

### `resolveRef(ref, baseCodocPath)` → `NodeId`

Pure, no IO. Resolves relative paths against `baseCodocPath`'s directory using hand-rolled posix helpers (core never touches `node:path`). Produces the canonical `NodeId` that `dag/` will look up.

## When editing this subtree

- **Never import from `dag/` or `cobook/`.** The import direction is one-way.
- **Never add `workspaceId`, `createdAt`, or storage-only fields.** If you feel the pull, the new field belongs in the storage projection, not the core entity.
- **Prefer adding a new variant to an existing ADT over adding a flag.** `kind: "newThing"` beats `isNewThing: boolean`.
- **Keep ref/path logic self-contained.** If you need a new path helper, add it inside `ref.ts` — do not introduce a dependency on `node:path` or any npm package.
