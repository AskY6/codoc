# ui/src/plugins-host/

Parent: `../../AGENTS.md` (`ui/`)
Reads from: `../../plugins/<id>/ui/index.ts` (via `@plugins/` alias), `../lib/event-bus.ts`
Must never import from: server runtime (`apps/local/src/**`), other plugins' internals.

## Purpose

Browser-side analog of `apps/local/src/plugins-host/`. Hosts a running plugin's UI
contributions (commands, MDX components, chat prompts) and disposes them when the
workspace switches.

## Surface

- `types.ts` — `UiActivateContext`, `Disposable`, `UiCommandHandler`.
- `host.ts` — `UiPluginHost` class.
- `registry.ts` — compile-time map from `pluginId` to `activateUi(ctx)` entrypoint.

## Lifecycle

```
App.tsx mounts → workspace opens → uiHost.activate({ pluginId, workspaceName, config })
                                    └── activateUi(ctx) registers commands + mdx + …
workspace switches / closes      → uiHost.deactivate() → all Disposables fire
```

## Command routing

`UiPluginHost.executeCommand(id, args)`:
1. If a local handler is registered (`ctx.commands.registerCommand`), call it directly.
2. Otherwise `POST /api/plugins/<pluginId>/commands/<id>` with `args` as JSON body.

This mirrors the server-side bus (`src/plugins-host/context.ts → ctx.commands`) so
the same `id` can resolve in either tier — the plugin author picks the registration
site based on whether the work happens in the browser or on the server.
