# service / usecases / workspace

Use cases that act on the workspace aggregate.

Parent: [`../AGENTS.md`](../AGENTS.md) — full use case rules.

## Slice 1 contents

| File | Purpose |
|---|---|
| `list-workspaces.ts` | Return every workspace as a `WorkspaceListItem` DTO. |
| `create-workspace.ts` | Mint a workspace from `{ name, description }`. The use case owns the id; transports never supply one. |
| `delete-workspace.ts` | Delete a workspace by id; cascade is enforced by the storage layer. |

## Conventions specific to this aggregate

- **DTO shape is `WorkspaceListItem`** (`{ workspace, updatedAt }`) — defined in `../../types/workspace.ts`. The transport layer just `JSON.stringify`s it.
- **No `withTransaction` yet** — every workspace use case in slice 1 is a single-store call. The first composite use case (e.g. "create workspace + seed default codoc") will introduce a transaction here and will be the place future slices copy.

The general "create use cases own the id" rule lives in [`../AGENTS.md`](../AGENTS.md) — `createWorkspace` is just an instance of it.
