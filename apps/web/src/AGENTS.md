# @cobook/web

Vite + React + Tailwind frontend. The first vertical slice ships only the workspace list page.

Parent: [`../../../packages/service/src/AGENTS.md`](../../../packages/service/src/AGENTS.md) — defines the use cases this UI consumes.
Reads from: the HTTP API exposed by `apps/server`. Never imports from `@cobook/*` packages.
Must never import from: anything in `packages/`.

## Why no shared types with the backend

Sharing types across the wire couples UI builds to backend internals (brands, package boundaries, build pipelines). `src/types.ts` mirrors the wire shapes manually. The cost is low and the freedom is high. If the wire ever drifts the api client tests will catch it, not the type system.

`WorkspaceListItem` nests the canonical `Workspace` object while `CodocListItem` and `CodocDetail` are both flattened — that asymmetry is deliberate and comes from the backend (see `packages/service/src/types/codoc.ts`). `Codoc.ast` holds `ReadonlyMap`s that JSON-serialise to `{}`, so nesting would lose data. This side of the wire mirrors that shape rather than inventing its own.

## Layout

```
src/
  main.tsx                React root + QueryClientProvider + BrowserRouter
  app.tsx                 routes: / (list), /workspace/:id (detail),
                          /workspace/:workspaceId/codoc/:codocId (codoc edit)
  index.css               tailwind base
  types.ts                wire-level DTO mirrors
  api/
    client.ts             apiFetch + ApiError envelope parsing
    sse.ts                SSE streaming client (fetch + ReadableStream parser)
                          for agent turns and reconnect
    workspaces.ts         listWorkspaces / getWorkspace / create / update / delete
    codocs.ts             listCodocsByWorkspace / createCodoc / getCodoc /
                          updateCodocContent / deleteCodoc
    threads.ts            listThreadsByWorkspace / createThread / getThread /
                          deleteThread / setThreadAgents / setThreadCodocs
    agents.ts             listAgents
  pages/
    workspace-list.tsx    / — cards link to the detail route
    workspace-detail.tsx  /workspace/:id — header + codoc list with create / delete;
                          codoc cards link to the codoc detail route
    codoc-detail.tsx      /workspace/:workspaceId/codoc/:codocId — content
                          editor with optimistic concurrency + conflict recovery
  components/
    ui/
      button.tsx
      card.tsx
      dialog.tsx
      input.tsx
      cn.ts               class-name helper used by primitives
```

## Conflict recovery for long-form documents

Slice 1.5 established the "force refetch + require re-save" recovery
flow for small dialog-level edits (workspace rename). Slice 3 added
a second pattern for long-form content (codoc editor): on 409 the
detail query is invalidated so the cache holds the fresh `rev`, but
the editor buffer is **deliberately not** reset. The page surfaces
an inline amber warning with two options — save again (overwrite) or
reload from server (discard draft). See
`packages/service/src/usecases/codoc/AGENTS.md` for the service-side
rationale; the client half lives in `pages/codoc-detail.tsx`.

## Conventions

- **`@tanstack/react-query` is the data layer.** No `useEffect + fetch + useState`. Mutations always invalidate the related query keys on success.
- **API errors throw.** `apiFetch` parses `{ error: { kind, ... } }` and throws `ApiError`. React-query catches the throw — page code never inspects HTTP statuses.
- **No design system yet.** Slice 1 hand-rolls four primitives. AI Elements arrives when a later slice introduces richer components.
- **SSE streaming for agent turns.** `api/sse.ts` provides `runAgentTurnStream` (POST-based, not EventSource) and `reconnectStream` (GET-based). The `ChatThreadPage` accumulates tokens in local state for an optimistic streaming bubble; on `done` it invalidates the thread query to pick up the canonical server messages. A "Stop" button aborts the fetch controller.
- **No CORS, no env config.** Vite proxies `/api → http://localhost:3100`. `fetch("/api/workspaces")` works because dev is same-origin.
- **Tailwind 4 via `@tailwindcss/vite`.** No `tailwind.config.ts` — v4 uses CSS-driven config in `index.css`.
