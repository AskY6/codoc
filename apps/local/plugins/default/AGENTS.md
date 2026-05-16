# plugins/default/

Parent: `../AGENTS.md`
Reads from: `../../src/plugins/types.js`, `@cobook/core`.
Must never import from: any other plugin.

## Purpose

Fallback plugin for workspaces without a specific `workspaceKind`. Returns empty config, contributes no domain-specific runtime.

## Files

- `manifest.json` — metadata only (Phase 1)
- `server/index.ts` — single-export `defaultPlugin: WorkspacePlugin<{}>`
