# Codoc

Composable knowledge workspace — structured documents with data dependencies, resolved by a DAG engine.

## Architecture

```
┌─────────────┐     ┌─────────────┐
│   Web (UI)  │     │  CLI (TUI)  │
│  apps/web   │     │  apps/cli   │
└──────┬──────┘     └──────┬──────┘
       │  HTTP             │  HTTP
       └────────┬──────────┘
                ▼
       ┌────────────────┐
       │  Server (API)  │
       │  apps/server   │
       └───────┬────────┘
               │
       ┌───────┴────────┐
       │    Service      │
       │ packages/service│
       └───────┬────────┘
               │  SQL
               ▼
       ┌────────────────┐
       │  PostgreSQL     │
       └────────────────┘
```

### Hard rules

1. **Database is the single source of truth.** All data (workspaces, codocs, edges, chat, agent state) lives in PostgreSQL.
2. **Server depends only on the database.** Zero filesystem reads/writes. No `node:fs`, `node:path`, or `node:os` imports in `packages/service/` or `apps/server/`.
3. **CLI and Web are thin view layers.** They are pure HTTP callers of the Server API. No filesystem dependencies. No local state.

### Layers

| Layer | Package | Depends on | Never depends on |
|-------|---------|-----------|-----------------|
| **Web** | `apps/web` | Server API (HTTP) | Database, filesystem |
| **CLI** | `apps/cli` | Server API (HTTP) | Database, filesystem |
| **Server** | `apps/server` | Service | Filesystem |
| **Service** | `packages/service` | Database (PostgreSQL) | Filesystem |
| **Core** | `packages/core` | Nothing | Database, filesystem, network |

## Tech stack

- **Monorepo**: pnpm workspaces
- **Language**: TypeScript (strict, exactOptionalPropertyTypes)
- **Database**: PostgreSQL + Drizzle ORM
- **Server**: Hono + @hono/node-server
- **Web**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui (base-nova style, @base-ui/react)
- **CLI**: Commander.js
- **AI**: Anthropic Claude SDK

## Key commands

```bash
pnpm --filter <pkg> typecheck    # Type-check a package
pnpm --filter <pkg> build        # Build a package
pnpm --filter <pkg> test         # Run tests (requires DATABASE_URL)
pnpm --filter @cobook/web dev    # Start web dev server (port 5173)
```

## Database migrations

```bash
cd packages/service
npx drizzle-kit generate    # Generate migration from schema changes
npx drizzle-kit migrate     # Apply migrations
```
