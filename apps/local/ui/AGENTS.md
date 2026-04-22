# apps/local/ui

**Parent:** `apps/local/AGENTS.md`
**Reads from:** `apps/local/src/api-routes.ts` (API contract)
**Must never import from:** `@cobook/*` packages, `node:*` modules

## Purpose

Local web UI — a Vite + React 19 + TailwindCSS v4 SPA served by the
`codoc` Hono server. Talks to the backend exclusively via REST endpoints
under `/api`.

## Architecture

```
ui/
├── src/
│   ├── main.tsx           — React entry (mounts <App/>)
│   ├── App.tsx            — Layout: sidebar + tabbed content area
│   ├── api.ts             — Typed fetch wrapper for /api/* endpoints
│   └── components/
│       ├── FileTree.tsx   — Recursive directory tree sidebar
│       ├── Editor.tsx     — Plain textarea editor with save
│       ├── Preview.tsx    — Markdown rendering (react-markdown)
│       └── DataPanel.tsx  — Data field table (kind + resolved status)
├── index.html
├── vite.config.ts         — Vite config (builds to ../dist/ui/)
└── tsconfig.json          — Browser-targeted TS config
```

## Conventions

- **No direct FS access** — all data via `/api` fetch calls
- **No shared types with server** — api.ts defines its own response types
  matching the JSON shapes from api-routes.ts
- **Dev mode**: `pnpm dev:ui` starts Vite on :5174 proxying /api → :4321
- **Prod mode**: `pnpm build:ui` outputs to `dist/ui/`, served by Hono
- All UI deps are devDependencies (build-time only, not bundled into server)
