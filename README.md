# Cobook

Composable knowledge workspace: structured documents with data dependencies, persisted in PostgreSQL and rendered through a DAG-driven workspace.

## Quickstart

Prerequisites: Node.js 20+, pnpm 10+, Docker Desktop, VSCode.

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Create `.env` and fill in LLM credentials**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set the three `LLM_*` fields:
   ```
   LLM_BASE_URL=https://api.openai.com/v1   # or any compatible gateway
   LLM_API_KEY=sk-...
   LLM_MODEL=gpt-4o                          # or claude-sonnet-4-6, etc.
   ```

3. **Open the project in VSCode, press `Cmd+Shift+B`**
   This starts PostgreSQL (Docker), runs migrations, and launches server + web + daemon.

4. **Open `http://localhost:5173`** — create a workspace from a preset, and you're in.

## VSCode Tasks

| Task | What it does |
|------|-------------|
| `dev` | DB + migrate → Server → Web → Daemon (Cmd+Shift+B) |
| `dev:parallel` | Server + Web + Daemon in parallel (assumes DB running) |
| `db:up` / `db:down` | Start (+ migrate) / stop PostgreSQL |
| `db:reset` | Destroy DB volume and recreate (data loss!) |
| `db:migrate` | Run Drizzle migrations |
| `db:studio` | Open Drizzle Studio (DB GUI) |
| `kill-ports` | Free ports 3100, 5173, 3999 |

## AI-assisted setup

If you use an AI coding assistant (Claude Code, Codex, Cursor, etc.), point it at [`SETUP.md`](SETUP.md) and ask it to set up the environment. It contains step-by-step commands with verification checks.

## Alternative setups

### Without VSCode

```bash
pnpm bootstrap          # start postgres + run migrations
pnpm dev                # start server + web (no daemon)
```

### Full Docker

Runs everything in containers — useful for quick evaluation without a local Node toolchain.

```bash
cp .env.example .env
pnpm docker:up          # start postgres + server + web
pnpm docker:down        # stop
```

## Troubleshooting

If startup fails:

- Make sure Docker Desktop is running.
- Make sure `.env` exists and includes `DATABASE_URL`.
- If port 55432, 3100, or 5173 is in use, run the `kill-ports` task or stop the conflicting process.

If chat does not work:

- Workspace browsing works without AI credentials.
- Chat and agents require valid `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` in `.env`.
