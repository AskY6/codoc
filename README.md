# Cobook

Composable knowledge workspace: structured documents with data dependencies, persisted in PostgreSQL and rendered through a DAG-driven workspace.

## Quickstart

### Half Docker (recommended for local development)

This mode runs PostgreSQL in Docker and keeps `web` / `server` on your machine for fast iteration.

```bash
pnpm install
cp .env.example .env
pnpm bootstrap
pnpm dev
```

Open `http://localhost:5173`.

### Full Docker (recommended for quick evaluation)

This mode runs `postgres + server + web` in containers.

```bash
pnpm install
cp .env.example .env
pnpm docker:up
```

Open `http://localhost:5173`.

To stop the full stack:

```bash
pnpm docker:down
```

## Optional AI Setup

AI-backed chat features are optional. Browsing the seeded demo workspace works without any LLM credentials.

If you want chat and agent features, fill in the optional `LLM_*` values in `.env`.

## Common Commands

```bash
pnpm bootstrap  # start postgres, run migrations, seed demo data
pnpm dev        # run server + web locally
pnpm db:up      # start postgres only
pnpm db:down    # stop postgres only
pnpm db:migrate # apply database migrations
pnpm db:seed    # seed the demo workspace
pnpm docker:up  # run postgres + server + web in containers
```

## What You Get After Setup

`pnpm db:seed` creates a preset workspace called `AI & Dev Radar` with:

- a non-empty workspace list
- a curated AI and engineering RSS starter pack with snapshot articles
- a derived dashboard codoc that merges multiple feeds
- a saved summary codoc that shows how feed content can become durable workspace knowledge
- built-in workspace agents enabled by default

## Troubleshooting

If `pnpm bootstrap` fails:

- Make sure Docker Desktop or another Docker-compatible runtime is running.
- Make sure `.env` exists and includes `DATABASE_URL`.
- If port `55432`, `3100`, or `5173` is already in use, update `POSTGRES_PORT` and `DATABASE_URL` together in `.env`, or stop the conflicting process.

If the app starts but chat does not work:

- The demo workspace and codoc browsing do not require AI credentials.
- Chat needs valid `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` values in `.env`.
