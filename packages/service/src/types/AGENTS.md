# service / types

UI-shaped DTOs returned by use cases.

Parent: [`../../AGENTS.md`](../AGENTS.md).

## Why a separate directory

Use cases return values to transports (HTTP, CLI, MCP). Those return values are NOT always plain core types — sometimes they are envelopes that strap on storage metadata (`updatedAt`, derived counts, …). Putting those envelope shapes here keeps three things straight:

- **Core types stay canonical.** `Workspace` lives in `@cobook/core` and never grows a `updatedAt`.
- **Storage envelopes stay storage-only.** `StoredWorkspace` / `Rev` / `Timestamp` never leak past `repo/`.
- **Transports get a single import path.** A route handler imports `WorkspaceListItem` from `@cobook/service` and `JSON.stringify`s it.

## Rules

- DTOs use plain JS values (`string`, `number`, nested `Workspace`). No branded `Timestamp`, no `Rev`. The brand belongs to storage.
- DTOs are nested, not flattened. `{ workspace: Workspace, updatedAt: number }`, not `{ id, name, description, updatedAt }`. This keeps the canonical core shape addressable as `dto.workspace`.
- One file per aggregate. Add new DTOs by extending the matching file (`workspace.ts`, future `codoc.ts`, …).
