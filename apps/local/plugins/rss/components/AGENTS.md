# plugins/rss/components/

Parent: `../AGENTS.md`
Reads from: `react` (and only what users get inside `.codoc` MDX bodies).
Must never import from: `../server/`, `../ui/`, `@cobook/*` internals, anywhere outside this directory.

## Purpose

MDX components shipped with the RSS plugin and rendered inside `.codoc` bodies (`ArticleList`, `DigestList`, `DigestStats`, `DigestTop`, `DigestTrending`, `FeedHeader`, `SourceBadge`).

## Bundling model (Phase 4)

These TSX files are **bundled into the SPA** at build time and registered via
`activateUi(ctx)` (see `../ui/index.ts`):

```ts
ctx.mdxComponents.register("ArticleList", ArticleList);
```

The UI plugin host merges them into the MDX component map between builtins and
the user's `.codoc/components/`. Users no longer get scaffolded copies on
`codoc init --from rss`.

Implications:
- These files are normal TSX modules — they may import from `react` (and only react).
- They are excluded from the apps/local server tsconfig (server doesn't render).
- Tailwind 4 scans them via the `@source "../../plugins/**/*.tsx"` directive in `ui/src/index.css`.
- Updates ship with the app — no per-workspace migration needed.

### Backwards compatibility

Workspaces created before Phase 4 keep a copy in
`~/.codoc/<workspace>/components/`. The user copy wins on collisions (custom
layer in `useCustomComponents` merges last), so legacy workspaces keep
rendering. The UI logs a console warning suggesting deletion; we don't
auto-migrate.
