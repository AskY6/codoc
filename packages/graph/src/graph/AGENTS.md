# graph/

The **pure mini-langgraph** subtree. Generic over state `S` and event `E`. Zero cobook concepts.

Parent: [`../../AGENTS.md`](../../AGENTS.md) — package-level invariants.
Reads from: `@cobook/core` for `Brand` and `Result` only.
Must never import from: `../cobook/`, `../tools/`, `../agents/`.

## Why this subtree exists

If you removed every other subtree from this package, `graph/` would still compile and still be usable. Its only contract with cobook is that downstream subtrees will pick specific types for `S` and `E`. Don't break this property.

## Modules

| File | What it owns |
|---|---|
| `ids.ts` | `NodeId` branded type, `END` sentinel |
| `state.ts` | `FieldReducer<T>`, `StateReducers<S>`, `mergeState` |
| `events.ts` | Placeholder for future generic event helpers; no runtime types today |
| `node.ts` | `NodeContext<E>`, `GraphNode<S, E, Id>` |
| `edge.ts` | `ConditionalBranch<S>`, `Edge<S>` ADT |
| `graph.ts` | `Graph<S, E>`, `GraphSpec<S, E>`, `buildGraph`, `BuildGraphError` |
| `executor.ts` | `runGraph`, `ExecutorOptions`, `ExecutionResult`, `RunGraphError` |

## Hard invariants

1. **No cobook words.** Not in types, not in comments, not in variable names. If you need to say "message" or "workspace", you are in the wrong subtree.
2. **`GraphNode.run` is pure w.r.t. its `state` argument.** It returns a `Partial<S>`; the executor merges it. Nodes must not mutate the object they were handed.
3. **No cycles.** This stage rejects back-edges in `buildGraph`. When cycles become necessary, add them behind an explicit opt-in on `GraphSpec`, not by loosening the validator.
4. **Errors are ADT variants, not exceptions.** `buildGraph` returns `Result<Graph, BuildGraphError>`; `runGraph` returns `Result<ExecutionResult, RunGraphError>`. Node bodies may throw — the executor wraps thrown errors into `kind: "nodeThrew"`.
5. **`emit` is fire-and-forget.** Nodes do not await it. The executor routes events to the caller-supplied handler synchronously in emission order.

## Extending this subtree

- Adding a new edge kind = adding a new variant to `Edge<S>` and teaching `runGraph` + `buildGraph` about it. Do not sneak a new field onto an existing variant.
- Adding a new executor option = extend `ExecutorOptions`. Do not add a second entry-point function.
- If you are tempted to reach into `cobook/` "just to get `CobookState`", the logic belongs in `cobook/`, not here.
