# @cobook/web

Vite + React + Tailwind frontend. The first vertical slice ships only the workspace list page.

Parent: [`../../../packages/service/src/AGENTS.md`](../../../packages/service/src/AGENTS.md) — defines the use cases this UI consumes.
Reads from: the HTTP API exposed by `apps/server`. Never imports from `@cobook/*` packages.
Must never import from: anything in `packages/`.

## Why no shared types with the backend

Sharing types across the wire couples UI builds to backend internals (brands, package boundaries, build pipelines). Slice 1 mirrors the wire shapes manually in `src/types.ts` — three interfaces, no logic. The cost is low and the freedom is high. If the wire ever drifts the api client tests will catch it, not the type system.

## Layout

```
src/
  main.tsx                React root + QueryClientProvider + BrowserRouter
  app.tsx                 routes (single route in slice 1)
  index.css               tailwind base
  types.ts                wire-level DTO mirrors
  api/
    client.ts             apiFetch + ApiError envelope parsing
    workspaces.ts         listWorkspaces / createWorkspace / deleteWorkspace
  pages/
    workspace-list.tsx    THE page; uses react-query for data flow
  components/
    ui/
      button.tsx
      card.tsx
      dialog.tsx
      input.tsx
      cn.ts               class-name helper used by primitives
```

## Conventions

- **`@tanstack/react-query` is the data layer.** No `useEffect + fetch + useState`. Mutations always invalidate the related query keys on success.
- **API errors throw.** `apiFetch` parses `{ error: { kind, ... } }` and throws `ApiError`. React-query catches the throw — page code never inspects HTTP statuses.
- **No design system yet.** Slice 1 hand-rolls four primitives. AI Elements arrives when slice 2/3 introduces chat UI.
- **No CORS, no env config.** Vite proxies `/api → http://localhost:3100`. `fetch("/api/workspaces")` works because dev is same-origin.
- **Tailwind 4 via `@tailwindcss/vite`.** No `tailwind.config.ts` — v4 uses CSS-driven config in `index.css`.
