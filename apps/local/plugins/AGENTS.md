# apps/local/plugins/

Parent: `apps/local/AGENTS.md`
Reads from: nothing here; each plugin reads from `../../src/{domain,runtime,sources,plugins-host}` (server) or `@/`, `@plugins/` aliases (UI).
Must never import from: any other plugin (`./<other>/`); `@cobook/storage*`, `@cobook/service`, `@cobook/chat`, `@cobook/graph`.

## Purpose

One directory per workspace plugin. Each plugin is a self-contained vertical capability pack — `manifest.json`, server runtime, UI panels, MDX components, scaffold template — all colocated.

Phase 2 contract: `manifest.json` declares the static contributions and (where applicable) `server/index.ts` exports a function `activate(ctx)`. The host (`../src/plugins-host/`) wires it all together at compile time via `plugins-host/registry.ts`.

## Layout (per plugin)

```
plugins/<id>/
  manifest.json          # contributes block (sourceProviders, templates, configurationSchema, agentInstructions, mcpTools, views, mdxComponents, ui)
  agent-prompt.md        # (optional) long-form agent system prompt
  server/                # node runtime — activate(ctx), api routes, jobs, services
    index.ts             # exports `activate` plus named bindings the manifest's entry strings point at
  ui/                    # browser bundle — panels exposed to SPA
  components/            # MDX components shipped with the plugin
  template/              # scaffold for `codoc init --from <id>` (optional)
  AGENTS.md
```

## Registration (Phase 2, compile-time)

- Server: `src/plugins-host/registry.ts` imports each plugin's `<id>/manifest.json` plus the bindings referenced by `entry` pointers.
- UI: `ui/src/plugin-views/registry.ts` static-imports `@plugins/<id>/ui/index.ts` (Phase 4 moves this to `activateUi(ctx)`).
- Templates: contributed through the manifest; aggregated by `PluginHost.templates`.

Phase 6 replaces compile-time wiring with manifest-driven dynamic imports; the manifest schema is forward-compatible.

## Constraints

- Cross-plugin imports are forbidden — share via the host or core packages.
- Plugin TSX outside `ui/src/` requires `@source` entries in `ui/src/index.css` for Tailwind 4 JIT.
- TS files in `server/` and `template/` are typechecked; `components/` and `ui/` are excluded from the server tsconfig (they are bundled by Vite or read as raw strings).
- `entry: "server/sources.ts#rssProvider"` strings in manifests are documentation only in v1; actual resolution happens at compile time via `../src/plugins-host/registry.ts`.
