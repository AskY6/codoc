# service / ports

Outbound ports the service layer needs that are NOT covered by `@cobook/storage`.

Parent: [`../../AGENTS.md`](../AGENTS.md).

## Why ports live here

A use case talks to the outside world through three kinds of dependency:

1. **Storage** — owned by `@cobook/storage` (and the matching `Storage*Store` interfaces). One package, well established.
2. **Runtimes** — `@cobook/chat`, `@cobook/graph`. Imported directly by use cases.
3. **Everything else** — id generation, time-of-day, randomness, outbound HTTP, … These are small, infrastructure-flavoured contracts owned by the service layer because the service layer is their only consumer.

The third bucket lives here. Each port is one TypeScript interface, no impl, no runtime dep. Concrete impls live in `apps/server` (production) and in `__tests__/helpers/` (tests).

## Adding a new port

1. Add a single-purpose interface here. Don't bundle unrelated capabilities into one giant `Env` interface.
2. Add the port as a field on `ServiceCtx` in `../context.ts`.
3. Re-export the port type from `../index.ts` so transports can write their own impl.
4. Provide a real impl in `apps/server/src/ports/` and a deterministic test impl in `__tests__/helpers/`.

## Slice 1 ports

- `IdGenerator` — mints branded ids. Slice 1 only mints `WorkspaceId`; future slices add a method per id type they need.
