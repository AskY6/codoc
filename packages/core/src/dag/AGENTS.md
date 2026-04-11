# dag/

Field-level dependency graph built over codocs. **Not a general-purpose graph library** — every function here is coupled to codoc's `data` block and `Ref` resolution rules.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — global invariants.
Reads from: [`../codoc/AGENTS.md`](../codoc/AGENTS.md) — `CodocAST`, `CodocPath`, `FieldName`, `NodeId`, `DataField`, `resolveRef`.
Must never import from: `cobook/`.

## Mental model

Every `data.*` field inside every codoc becomes one **vertex**. An edge `A → B` means "field A depends on field B" (A's value is derived from B's value). The DAG is an **immutable snapshot** — mutations produce a new DAG via `buildDAG`.

```
codoc "notes/a.codoc"           codoc "notes/b.codoc"
  data.summary  ────── ref ──►    data.title
  data.body                       data.body
       │
       └── data.body is static, no outgoing edge
```

## Types (`types.ts`)

```ts
interface DAGNode {
  id: NodeId;         // "<codocPath>#data.<fieldName>"
  codocPath: CodocPath;
  fieldName: FieldName;
  field: DataField;   // cached from codoc AST for fast traversal
}

interface DAGEdge {
  from: NodeId;       // the dependent
  to: NodeId;         // the dependency
}

interface DAG {
  nodes: ReadonlyMap<NodeId, DAGNode>;
  edges: readonly DAGEdge[];
  dependencies: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;  // upstream
  dependents:   ReadonlyMap<NodeId, ReadonlySet<NodeId>>;  // downstream
}
```

`dependencies` / `dependents` are **pre-built adjacency indices**, populated during `buildDAG`. Upstream / downstream queries are O(1), not O(edges). Never walk `edges` in application code — use the indices or the helpers below.

## NodeId encoding (`node-id.ts`)

```
<codocPath>#data.<fieldName>
```

The separator constant is `"#data."`.

```ts
makeNodeId(codocPath, fieldName) → NodeId
parseNodeId(nodeId) → ParsedNodeId | null
```

Why the encoding lives here: it couples `codocPath` and `fieldName` into the identity that edges, invalidation, and topo sort all operate on. `codoc/` owns the `NodeId` **type**; `dag/` owns the **encoding format**. Keep these in sync with `codoc/ref.ts:resolveRef`, which produces the same string.

## `buildDAG(codocs)` (`build.ts`)

```ts
buildDAG(codocs: ReadonlyMap<CodocPath, CodocAST>): Result<DAG, readonly BuildError[]>
```

Two-pass construction:

1. **Pass 1** — materialise every `data.*` field of every codoc as a `DAGNode`.
2. **Pass 2** — for each `kind: "ref"` field, resolve to a target `NodeId` via `resolveRef`, and add an edge if the target exists.

### Error: `unknown-target`

If a ref points at a node no codoc produces, that is an error — **the build does not short-circuit**. Every `unknown-target` is collected in one pass so the caller can surface all of them together. This is a deliberate change from legacy behaviour, which silently created dangling edges.

```ts
type BuildError = {
  kind: "unknown-target";
  source: NodeId;
  target: NodeId;
  fromCodoc: CodocPath;
  fromField: FieldName;
};
```

## `topoSort(dag)` (`topo.ts`)

Kahn's algorithm, dependencies-first.

```ts
type TopoResult =
  | { kind: "sorted"; order: readonly NodeId[] }
  | { kind: "unsortable"; sortedPrefix: readonly NodeId[]; remaining: readonly NodeId[] };
```

`unsortable` surfaces both **what could be ordered** and **what remained blocked** (nodes participating in or downstream of a cycle). Legacy silently dropped these; we no longer do.

## `checkCycles(dag)` (`cycle.ts`)

DFS colouring (WHITE / GRAY / BLACK). Every back edge becomes one reported cycle.

```ts
type CycleCheck =
  | { kind: "acyclic" }
  | { kind: "cyclic"; cycles: readonly Cycle[] };

interface Cycle { path: readonly NodeId[]; }  // first === last (the entry point)
```

ADT rather than a possibly-empty array — callers must handle both branches explicitly.

## `invalidate(dag, seed)` (`invalidate.ts`)

BFS over the `dependents` index. Returns every node transitively downstream of `seed`, **including `seed` itself**. Pure — does not mutate the DAG or any node state. Callers decide what to do with the affected set (flip state, enqueue recompute, etc.).

## `upstream` / `downstream` (`query.ts`)

```ts
upstream(dag, nodeId)   // immediate dependencies  (one hop)
downstream(dag, nodeId) // immediate dependents    (one hop)
```

For transitive walks, use `invalidate` (downstream) or write the upstream equivalent — do not roll your own BFS on the raw `edges` array.

## When editing this subtree

- **Immutability is load-bearing.** Never mutate a `DAG` after `buildDAG` returns. If you need a modified graph, call `buildDAG` again with the new codoc set.
- **Do not add `workspaceId` / tenancy fields to `DAGNode`.** A DAG is defined per codoc set; tenancy is layered on top in `cobook/`.
- **Keep error handling uniform.** Build errors batch into `readonly BuildError[]`. Traversal outcomes are ADTs (`TopoResult`, `CycleCheck`) — don't return `null` or throw.
- **Coordinate encoding changes with `codoc/ref.ts`.** Both files must agree on the `<path>#data.<field>` shape.
