# plugins/default/

Parent: `plugins/`
Reads from: `../types.ts`
Must never import from: `../../workspace-service.js`, any sibling plugin

## Purpose

Fallback plugin for workspaces without a specific `workspaceKind`. Returns empty config, contributes no domain-specific runtime.
