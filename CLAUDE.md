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

## Chat: multi-agent group chat

Chat adopts a **router + specialist** group chat model. A single thread can involve multiple agents, and every assistant message is attributed to a specific agent.

### Message flow

```
User sends message (optionally @agent-id)
    ↓
Router Agent (sees full chatContext)
    ├── Can answer itself → replies (tagged as router)
    └── Needs specialist  → extracts relevant context → delegates to best-matching agent
                                                            ↓
                                                  Agent replies (tagged as agent-x)
```

### Design constraints

1. **One response per user message.** Either the router answers or exactly one specialist answers — never multiple.
2. **Silent routing.** No intermediate "forwarding to X" messages. The user sees the specialist's reply directly.
3. **Shared context.** All agents share the same chatContext (full message history). The router extracts relevant context before handing off.
4. **User can @mention.** `@agent-id` in the message bypasses routing and forces that agent to respond.
5. **Message attribution.** Every assistant message carries an `agentId` so the UI can show which agent responded.

### Data model impact

- `chat_messages` gains an `agent_id` column (which agent produced this assistant message).
- `chat_threads.agent_id` single-value field is replaced by a `thread_agents` join table (many-to-many).
- The message send API accepts an optional `targetAgentId` for explicit @-routing.
- SSE stream events include `agentId` so the frontend can render agent identity in real time.
