# sources/

Parent: `apps/local/src/`
Reads from: `../workspace/index.js` (workspace shape), `../workspace/service.js` (cache writer)
Must never import from: `../server/`, `../commands/`, `../plugins/`, `../providers/`

## Purpose

Periodic refresh of `$source` data fields with an `interval`. Persists
`lastFetchedAt` and cached resolved values to `.source-state.json` so reloads
don't re-fetch on startup.

## Key files

- `state.ts` — persistent JSON state (`readSourceState`, `writeSourceState`,
  `withEntry`, `SourceStateEntry`, `SourceStateMap`). Keyed by `NodeId`.
- `scheduler.ts` — background loop (`startSourceScheduler`, `refreshAllSources`,
  `refreshSingleSource`); concurrency-limited, provider-owned merge semantics.
- `mutex.ts` — async mutex (only the scheduler uses it for write serialization).

## Constraints

- Loss of `.source-state.json` is non-fatal — sources re-fetch on next tick.
- The scheduler is the only writer to `lastFetchedAt`; readers in other subtrees
  are read-only via `state.ts`.
