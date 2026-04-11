# @cobook/service

The **use-case layer**. This package owns every business action the
outside world can trigger: HTTP handlers, CLI commands, MCP tools, and
any future transport all go through a use case defined here.

Parent: [`../../CLAUDE.md`](../../CLAUDE.md) — project-wide layering
rules and the tree-context doc discipline.

Siblings:
- [`../core/AGENTS.md`](../core/AGENTS.md) — pure domain types + logic
- [`../storage/AGENTS.md`](../storage/AGENTS.md) — the storage port this package consumes
- [`../graph/AGENTS.md`](../graph/AGENTS.md) — generic agent/tool runtime
- [`../chat/AGENTS.md`](../chat/AGENTS.md) — chat specialization of graph

## Where this package sits

```
@cobook/core        pure domain types + logic (no IO)
     ↑
@cobook/storage     storage port (interfaces only)
     ↑
<impl packages>     in-memory / Postgres / ... implementations
     ↑
@cobook/service     ← this package — use cases, orchestration, tx
     ↑
<transport layers>  HTTP / CLI / MCP / ...
```

Service is the **first consumer of every port**: if a store method or
error variant is missing, add it to `@cobook/storage` and let the use
case drive the design, rather than designing ports in isolation.

## Internal layering (same package, two subtrees)

```
src/
  context.ts        ServiceCtx — Storage + Clock + (future) Logger / Auth
  errors.ts         service-level error ADT; maps storage errors upward
  repo/             thin store facades — pass-through + envelope peel + error map
  usecases/         business actions — orchestration, tx boundaries, runtime glue
  index.ts          public barrel
```

**Dependency direction (enforced by convention, not code):**

```
usecases/  ──▶  repo/   ──▶  @cobook/storage (port)
     │
     ├──▶  @cobook/chat / @cobook/graph    (runtime)
     └──▶  @cobook/storage                  (allowed — direct, for tx / multi-store composition)
```

- `repo/` **only** depends on `@cobook/storage` and `@cobook/core`. It
  does not know `usecases/` exists. It does not import `chat` / `graph`.
- `usecases/` is the **only** place allowed to touch runtime packages
  (`@cobook/chat`, `@cobook/graph`) and the **only** place allowed to
  open a transaction.
- `usecases/` may call `repo/` for plain reads/writes, or may skip
  `repo/` and hit `ctx.storage` directly when it needs `withTransaction`
  or atomic multi-store composition. Both are fine — the choice is
  "am I doing plain pass-through, or am I orchestrating?".

## What `repo/` is responsible for

A repo module is a **thin facade over one storage Store**. Its only
jobs are:

1. **Peel `StoredX` envelopes.** Use cases see `Workspace`, not
   `StoredWorkspace`. `Rev` / `Timestamp` stay inside repo + the active
   transaction; they do not leak upward.
2. **Map storage errors to service errors.**
   `NotFound<"workspace">` → `WorkspaceNotFound`, etc. Use cases
   pattern-match on service error variants, not storage ones.
3. **Expose pure-read compositions.** If a query is logically one
   question but needs to touch two stores (e.g. "list threads with
   their linked codoc ids"), and there are no writes and no events, it
   belongs in repo. The instant writes or events enter the picture,
   the code must move up to a use case.

A repo module **must not**:

- open a transaction — `withTransaction` lives in use cases
- emit domain events
- talk to `@cobook/chat` / `@cobook/graph`
- do authorization — that is a business decision, not a data-access
  decision
- do retry on conflict — conflicts propagate up, the use case decides
- cache anything — stateless pass-through only

### Repo method shape

Every repo method takes `ServiceCtx` as its first argument (so it can
transparently enroll in whatever transaction the use case has opened)
and returns `Result<T, ServiceError>` to match the rest of the stack.

```ts
// repo/workspace.ts — shape
export const workspaceRepo = {
  async get(
    ctx: ServiceCtx,
    id: WorkspaceId,
  ): Promise<Result<Workspace, WorkspaceNotFound>> { ... },

  async create(
    ctx: ServiceCtx,
    workspace: Workspace,
  ): Promise<Result<Workspace, WorkspaceAlreadyExists>> { ... },

  // ...
};
```

## What `usecases/` is responsible for

One file per business action. Files are grouped by aggregate
(`usecases/workspace/`, `usecases/chat/`, `usecases/codoc/`, …) but
each file is self-contained:

```ts
// usecases/chat/send-message.ts — shape
export async function sendMessage(
  ctx: ServiceCtx,
  input: SendMessageInput,
): Promise<Result<SendMessageOutput, SendMessageError>> {
  // 1. authorize
  // 2. open tx if needed
  // 3. call repo / storage / chat runner
  // 4. emit events
  // 5. return a UI-shaped DTO
}
```

Use cases are where the following concerns live:

- **Transactions.** Every multi-store write opens exactly one
  `storage.withTransaction`. Nested transactions are not allowed.
- **Runtime orchestration.** Driving `@cobook/chat` runners, wiring
  tools, translating runner events to domain events.
- **Authorization.** Coarse-grained "can this principal do this action
  on this aggregate". Fine-grained row-level filtering that the storage
  layer can express natively (e.g. scoping by `workspaceId`) should be
  a store method parameter, not a post-filter.
- **Event emission.** When we add an event bus, only use cases publish.

Use cases **must not**:

- add new domain types — those belong in `@cobook/core`
- add new reducers / tool execution logic — those belong in `@cobook/chat`
  or `@cobook/graph`
- write raw SQL or bypass the storage port — that belongs in a concrete
  storage adapter

## ServiceCtx

`ServiceCtx` is the per-request environment every use case and repo
receives. It wraps the storage port, a clock, and (eventually) a
logger / principal / tracing context. Think of it as the service-layer
equivalent of storage's `Ctx`, one layer up.

```ts
interface ServiceCtx {
  readonly storage: Storage;     // the port, not an impl
  readonly storageCtx: StorageCtx; // auto-commit ctx, or the active tx ctx
  readonly clock: Clock;
  // readonly principal: Principal; // when auth lands
  // readonly logger: Logger;       // when logging lands
}
```

Use cases that need a transaction open one by calling
`ctx.storage.withTransaction(async (tx) => ...)` and pass a **new
`ServiceCtx`** whose `storageCtx` is the transaction handle to every
repo / storage call inside. Use cases that only do one store call
reuse the ambient auto-commit `storageCtx`.

## Testing

Service tests run against a real in-memory implementation of the
`Storage` port (a future `@cobook/storage-memory` package), not mocks.
This keeps tests honest about the port's semantics and gives the
future Postgres adapter a conformance baseline.

## What does NOT go here

- No domain types — if you need a new type that is not a DTO, put it
  in `@cobook/core`.
- No runtime engine code — if you need a new reducer, tool executor,
  graph node, etc., put it in `@cobook/chat` or `@cobook/graph`.
- No storage backends — no SQL, no `fs`, no drivers.
- No transport code — HTTP routing, request parsing, response
  serialisation live in a transport package that imports this one.
- No side effects at import time — every module is a pure definition;
  effects only run when a use case is invoked with a `ServiceCtx`.
