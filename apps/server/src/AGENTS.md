# @cobook/server

HTTP transport for the cobook backend. Hono + `@hono/node-server`.

Parent: [`../../packages/service/src/AGENTS.md`](../../packages/service/src/AGENTS.md) — owns the use cases this server exposes.
Reads from: `@cobook/core`, `@cobook/chat`, `@cobook/service`, `@cobook/storage`, `@cobook/storage-memory`.
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
  streaming.ts         ActiveStream tracking for SSE reconnect
  ports/
    id.ts              UuidIdGenerator (crypto.randomUUID)
  http/
    error.ts           mapServiceError — single source of truth for HTTP status + envelope
  routes/
    workspaces.ts      GET / POST / PATCH / DELETE for the workspace aggregate
                       + nested GET/POST /:id/codocs + PUT /:id/agents
    codocs.ts          GET / PUT / DELETE /:id for the codoc aggregate
    threads.ts         Thread CRUD + PUT /:id/agents + PUT /:id/codocs
                       + POST /:id/turn (SSE streaming agent turn)
                       + GET /:id/stream (reconnect to in-progress stream)
    agents.ts          GET /api/agents (list registered agents)
```

## Conventions

- **Wire shape for errors:** `{ error: { kind: string, ...details } }`. The discriminator on the inner object is the `ServiceError.kind`, so clients can pattern-match without re-parsing.
- **Status mapping** lives in `http/error.ts`. Routes never decide a status inline. Adding a new `ServiceError` variant requires extending the switch — TypeScript enforces this via the exhaustive default.
- **Bad request** errors (`400`) carry `{ kind: "bad-request", reason: string }` — they are NOT `ServiceError`s, because they are caught at the transport boundary before any use case runs.
- **No CORS.** Same-origin via Vite dev proxy is the dev story; production will get a proper origin policy.
- **Routers are parameterised** over a `ServiceCtx`, never over a specific use case factory. They import use cases directly by name from `@cobook/service`.
- **SSE streaming** uses `streamSSE` from `hono/streaming`. `POST /api/threads/:id/turn` returns an SSE stream (not JSON). Active streams are tracked in `streaming.ts` for reconnect via `GET /api/threads/:id/stream`. Events: `token`, `toolCall`, `toolResult`, `done`, `title-update`, `error`. At most one active stream per thread; concurrent requests return `409`.
- **Auto-title** fires after the first assistant response on a title-less thread. Uses Haiku (via `LlmClient`) to generate a short title, persists via `updateThread`, and emits a `title-update` SSE event. Fire-and-forget — failure is silently ignored.
