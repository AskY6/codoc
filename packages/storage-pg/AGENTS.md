# @cobook/storage-pg

**Parent:** `packages/AGENTS.md` (or repo root `AGENTS.md`)
**Reads from:** `@cobook/core` (domain types), `@cobook/storage` (port interfaces)
**Must never import from:** `@cobook/service`, `@cobook/chat`, `@cobook/graph`, `@cobook/storage-memory`

## Purpose

PostgreSQL implementation of the `Storage` port. Swappable with `@cobook/storage-memory` via a one-line change in the server composition root.

## Key design choices

### Ctx carries a Drizzle handle

`PgCtx extends Ctx` holds either the base `PostgresJsDatabase` (auto-commit) or a `PgTransaction` — both share the same query API. Every store method calls `pgDb(ctx)` (single cast point in `ctx.ts`).

### RollbackSentinel for err-path rollback

Drizzle commits on normal return, rolls back on throw. The Storage port requires rollback on `err(...)`. A private `RollbackSentinel` is thrown and caught in the outer handler to bridge this gap.

### FK constraints replace callback wiring

Unlike `storage-memory`'s late-binding refs and `__cascadeDelete*` hooks, PG uses:
- `ON DELETE CASCADE` for workspace → dependent tables
- `ON DELETE RESTRICT` for `thread_codocs.codoc_id` (enforces referrer check)
- `ON DELETE SET NULL` for `agent_sessions.thread_id` (sessions survive thread deletion)
- FK violations caught and mapped to storage error ADTs

### Serde layer (`serde.ts`)

- `CodocAST` contains `ReadonlyMap<FieldName, ...>` → serialized to plain objects via `Object.fromEntries`, deserialized back with `new Map` + branded casts
- `ChatMessage` discriminated union → flattened to columns (`kind`, `content`, `agent_id?`, `metadata?`), reconstructed on read

### Message seq

Assigned atomically in the INSERT via `(SELECT COALESCE(MAX(seq), 0) + 1 ...)` subquery.

## Subtrees

```
src/
├── schema.ts        — Drizzle table definitions (9 tables)
├── ctx.ts           — PgCtx type + pgDb() extractor
├── connection.ts    — postgres client + drizzle instance
├── serde.ts         — ReadonlyMap / ChatMessage serialization
├── pg-error.ts      — PG error code classification
├── clock.ts         — SystemClock
├── storage.ts       — composition root (createPgStorage)
├── index.ts         — public barrel
└── stores/          — one file per Store interface
```
