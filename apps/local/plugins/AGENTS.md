# apps/local/plugins/

Parent: `apps/local/AGENTS.md`
Reads from: nothing here; each plugin reads from `../../src/{domain,runtime,sources,plugins/types}` (server) or `@/`, `@plugins/` aliases (UI).
Must never import from: any other plugin (`./<other>/`); `@cobook/storage*`, `@cobook/service`, `@cobook/chat`, `@cobook/graph`.

## Purpose

One directory per workspace plugin. Each plugin is a self-contained vertical capability pack — server runtime, UI panels, MDX components, scaffold template, and a `manifest.json`.

The current `WorkspacePlugin` interface (defined at `../src/plugins/types.ts`) is still the wire format; manifests in Phase 1 only carry `id` / `name` / `description`. Phase 2 will populate `contributes` and replace the interface with manifest + `activate(ctx)`.

## Layout (per plugin)

```
plugins/<id>/
  manifest.json          # metadata; Phase 2 will add contributes
  server/                # Node runtime — api routes, jobs, services
  ui/                    # browser bundle — panels exposed to SPA
  components/            # MDX components shipped with the plugin
  template/              # scaffold for `codoc init --from <id>` (optional)
  AGENTS.md
```

## Registration (Phase 1, compile-time)

- Server: `src/plugins/registry.ts` static-imports `<id>/server/index.js`
- UI: `ui/src/plugin-views/registry.ts` static-imports `@plugins/<id>/ui/index.ts`
- Template: `src/templates/index.ts` static-imports `<id>/template/index.js`

Phase 2 makes registration manifest-driven. The compile-time aggregators stay until then.

## Constraints

- Cross-plugin imports are forbidden — share via the host or core packages
- Plugin TSX outside `ui/src/` requires `@source` entries in `ui/src/index.css` for Tailwind 4 JIT
- TS files in `server/` and `template/` are typechecked; `components/` and `ui/` are excluded from the server tsconfig (they are bundled by Vite or read as raw strings)
