# Automated Setup Guide

Machine-readable setup instructions for AI coding assistants (Claude Code, Codex, Cursor, etc.).
Point your AI tool at this file when asking it to set up the dev environment.

## Step 0 — Preflight check (requires user action on failure)

Run each command below. If any fails, **stop and tell the user what is missing** before continuing.

| Check | Command | Expected |
|-------|---------|----------|
| Node.js | `node --version` | 20+ |
| pnpm | `pnpm --version` | 10+ |
| Docker | `docker info` | exits 0 (daemon running) |

**If Node.js is missing**, tell the user:
> Node.js 20+ is required. Install it from https://nodejs.org/ or via a version manager (nvm, fnm, mise).

**If pnpm is missing**, tell the user:
> pnpm 10+ is required. Install it with `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate`.

**If Docker fails**, tell the user:
> Docker is required for the database. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and make sure it is running.

Do not proceed until all three checks pass.

## Setup steps

Run these commands sequentially from the repo root.

### Step 1 — Install dependencies

```bash
pnpm install
```

### Step 2 — Configure .env (requires user input)

```bash
cp .env.example .env
```

After copying, read the `.env` file and check whether `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` are set (non-empty).

**If any of them are empty, stop and ask the user:**

> I need your LLM credentials to complete the setup. Please provide:
>
> 1. **LLM_BASE_URL** — an OpenAI-compatible API endpoint (e.g. `https://api.openai.com/v1`)
> 2. **LLM_API_KEY** — your API key
> 3. **LLM_MODEL** — the model to use (e.g. `gpt-4o`, `claude-sonnet-4-6`)
>
> These are required for chat and agent features. If you don't have them yet, I can skip this and you can add them to `.env` later — workspace browsing will still work.

Once the user provides values (or explicitly skips), write them into `.env` and continue.

### Step 3 — Start PostgreSQL and apply migrations

```bash
docker compose up -d postgres
```

Wait for postgres to accept connections:

```bash
until docker compose exec postgres pg_isready -U postgres -d cobook_dev 2>/dev/null; do sleep 1; done
```

Apply database migrations:

```bash
pnpm db:migrate
```

### Step 4 — Start dev services

```bash
pnpm dev
```

This starts the API server (port 3100) and web frontend (port 5173).

## Verification

All checks must pass before reporting success.

```bash
# API responds
curl -sf http://localhost:3100/api/workspace > /dev/null

# Web responds
curl -sf http://localhost:5173 > /dev/null
```

If both pass, tell the user: open http://localhost:5173 to get started.

## Teardown

```bash
# Stop dev services: Ctrl+C the pnpm dev process

# Stop postgres
docker compose down

# Full reset (destroys all data)
docker compose down -v
```

## Ports

| Service    | Port  |
|------------|-------|
| PostgreSQL | 55432 |
| API Server | 3100  |
| Web        | 5173  |

## Common errors

| Symptom | Fix |
|---------|-----|
| `port is already allocated` | `lsof -ti:55432 \| xargs kill -9` (or 3100, 5173) |
| `ECONNREFUSED` on migrate | Postgres not ready yet — retry the `pg_isready` loop |
| `Missing .env file` | Run `cp .env.example .env` |
| Chat returns errors | Check `LLM_*` values in `.env` |
