# service / usecases

Business actions. One file per use case, grouped by aggregate.

Parent: [`../../AGENTS.md`](../AGENTS.md) — full layering rules and
the rationale for splitting repo vs. usecases.

## File layout

```
usecases/
  workspace/
    create-workspace.ts
    delete-workspace.ts
    ...
  codoc/
    ...
  chat/
    send-message.ts
    run-agent-turn.ts
    ...
  index.ts          barrel — re-exports every use case
```

Group by aggregate, not by verb. `create-workspace` goes next to
`delete-workspace` because they change together when workspace rules
change; they have nothing to do with `create-codoc`.

## Use case shape

One exported function per file. The function is pure-ish: it takes a
`ServiceCtx` plus a typed `Input`, returns a `Result<Output, Error>`,
and does not touch module-level state.

```ts
// usecases/workspace/create-workspace.ts — shape
export interface CreateWorkspaceInput {
  readonly workspace: Workspace;
}

export type CreateWorkspaceError = WorkspaceAlreadyExists;

export async function createWorkspace(
  ctx: ServiceCtx,
  input: CreateWorkspaceInput,
): Promise<Result<Workspace, CreateWorkspaceError>> {
  return workspaceRepo.create(ctx, input.workspace);
}
```

For a composite action that hits multiple stores, open exactly one
transaction and thread a new `ServiceCtx` through every repo / storage
call inside it:

```ts
// usecases/chat/attach-codoc-to-thread.ts — shape
export async function attachCodocToThread(
  ctx: ServiceCtx,
  input: AttachCodocToThreadInput,
): Promise<Result<void, AttachCodocToThreadError>> {
  return ctx.storage.withTransaction(async (tx) => {
    const txCtx = withStorageCtx(ctx, tx);
    const thread = await threadRepo.get(txCtx, input.threadId);
    if (!thread.ok) return thread;
    // ... more steps, all using txCtx ...
    return ok(undefined);
  });
}
```

## Rules

- **Exactly one transaction per use case.** Never nest
  `withTransaction`. If a use case needs to call another use case,
  extract the shared steps into a repo method or an internal helper
  instead.
- **Authorization happens here, not in repo.** When auth lands, the
  first line of every use case is a capability check against
  `ctx.principal`.
- **All runtime orchestration happens here.** Use cases are the only
  place allowed to import `@cobook/chat` / `@cobook/graph`.
- **Events are emitted here.** When an event bus lands, repo stays
  silent; only use cases publish.
- **Return a UI-shaped DTO, not a `StoredX` envelope.** The repo layer
  already peels envelopes, so use cases return pure core types (or
  composites built from them).
- **Error types are per-use-case unions.** Do not return the wide
  `ServiceError` union — a use case that cannot hit "codoc-referenced"
  should not declare that variant in its return type. Unions are
  narrowed per action so the transport layer gets useful exhaustive
  matching.
- **Create use cases own the id; transports never supply one.** A
  `create*` use case takes domain input (`{ name, description, ... }`)
  and mints the primary key via `ctx.idGen.<aggregate>Id()`. Letting an
  untrusted client choose its own primary key is a security hazard, and
  funnelling id minting through `IdGenerator` keeps tests deterministic.
  Add the matching method to `ports/id.ts` the first time a slice needs
  a new aggregate's id.

## Testing

Use cases are tested against a real in-memory `Storage` implementation
(`@cobook/storage-memory`), not mocks. See [`../../__tests__/AGENTS.md`](../../__tests__/AGENTS.md) for the helper layout, the `makeTestCtx` entry point, and the deterministic-`IdGenerator` convention.
