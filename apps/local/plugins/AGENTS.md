# apps/local/plugins/

Parent: `apps/local/AGENTS.md`
Reads from: nothing here; each plugin reads from `../../src/{domain,runtime,sources,plugins-host}` (server) or `@/`, `@plugins/` aliases (UI).
Must never import from: any other plugin (`./<other>/`); `@cobook/storage*`, `@cobook/service`, `@cobook/chat`, `@cobook/graph`.

## Purpose

One directory per workspace plugin. Each plugin is a self-contained vertical capability pack — `manifest.json`, server runtime, UI panels, MDX components, scaffold template — all colocated.

Phase 2 contract: `manifest.json` declares the static contributions and (where applicable) `server/index.ts` exports a function `activate(ctx)`. Phase 3 added `contributes.commands` + `contributes.menus`, registered via `ctx.commands.registerCommand` (server) and the matching UI host. Phase 4 ships MDX components through `activateUi(ctx)` instead of scaffolding them into user workspaces.

## Layout (per plugin)

```
plugins/<id>/
  manifest.json          # contributes block (sourceProviders, templates, configurationSchema, agentInstructions, mcpTools, commands, menus, views, mdxComponents, ui)
  agent-prompt.md        # (optional) long-form agent system prompt
  server/                # node runtime — activate(ctx) → routes / jobs / commands / mcp
    index.ts             # exports `activate` plus named bindings the manifest's entry strings point at
  ui/                    # browser entry — activateUi(ctx) registers commands + MDX components; also exports panels for the plugin-view registry
  components/            # MDX components shipped with the plugin
  template/              # scaffold for `codoc init --from <id>` (optional)
  AGENTS.md
```

## Registration (Phase 3/4, compile-time)

- Server: `src/plugins-host/registry.ts` imports each plugin's `<id>/manifest.json` plus the bindings referenced by `entry` pointers.
- Server commands: `activate(ctx)` calls `ctx.commands.registerCommand(id, handler)`; the host bridges them as `POST /api/plugins/<id>/commands/<cmdId>`.
- UI: `ui/src/plugins-host/registry.ts` static-imports `@plugins/<id>/ui/index.ts#activateUi`. `activateUi(ctx)` registers UI-side commands and MDX components.
- UI panels (secondary views) stay in `ui/src/plugin-views/registry.ts` so the SPA shell can mount them by view id; the host doesn't proxy them.
- Templates: contributed through the manifest; aggregated by `PluginHost.templates`.

Phase 6 replaces compile-time wiring with manifest-driven dynamic imports; the manifest schema is forward-compatible.

## Constraints

- Cross-plugin imports are forbidden — share via the host or core packages.
- Plugin TSX outside `ui/src/` requires `@source` entries in `ui/src/index.css` for Tailwind 4 JIT.
- TS files in `server/` and `template/` are typechecked; `components/` and `ui/` are excluded from the server tsconfig (they are bundled by Vite or read as raw strings).
- `entry: "server/sources.ts#rssProvider"` strings in manifests are documentation only in v1; actual resolution happens at compile time via `../src/plugins-host/registry.ts`.
