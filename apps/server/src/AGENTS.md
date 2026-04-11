# @cobook/server

HTTP transport for the cobook backend. Hono + `@hono/node-server`.

Parent: [`../../packages/service/src/AGENTS.md`](../../packages/service/src/AGENTS.md) — owns the use cases this server exposes.
Reads from: `@cobook/core`, `@cobook/service`, `@cobook/storage`, `@cobook/storage-memory`.
Must never import from: anything in `apps/web`.

## Composition root rule

`src/index.ts` is the **only** file in the entire repo that:

- imports from a concrete storage adapter (`@cobook/storage-memory`, future `@cobook/storage-pg`, …)
- constructs a `ServiceCtx`
- decides which `IdGenerator` / `Clock` impl to wire in

Routers receive a built `ServiceCtx` and remain ignorant of which adapter sits underneath. Tests can mount the same router against a different `ServiceCtx`.

## Layout

```
src/
  index.ts             composition root + Hono app + listen
  ports/
    id.ts              UuidIdGenerator (crypto.randomUUID)
  http/
    error.ts           mapServiceError — single source of truth for HTTP status + envelope
  routes/
    workspaces.ts      GET / POST / DELETE for the workspace aggregate
```

## Conventions

- **Wire shape for errors:** `{ error: { kind: string, ...details } }`. The discriminator on the inner object is the `ServiceError.kind`, so clients can pattern-match without re-parsing.
- **Status mapping** lives in `http/error.ts`. Routes never decide a status inline. Adding a new `ServiceError` variant requires extending the switch — TypeScript enforces this via the exhaustive default.
- **Bad request** errors (`400`) carry `{ kind: "bad-request", reason: string }` — they are NOT `ServiceError`s, because they are caught at the transport boundary before any use case runs.
- **No CORS.** Same-origin via Vite dev proxy is the dev story; production will get a proper origin policy.
- **Routers are parameterised** over a `ServiceCtx`, never over a specific use case factory. They import use cases directly by name from `@cobook/service`.
