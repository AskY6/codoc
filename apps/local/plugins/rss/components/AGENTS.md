# plugins/rss/components/

Parent: `../AGENTS.md`
Reads from: `react` (and only what users get inside `.codoc` MDX bodies).
Must never import from: `../server/`, `../ui/`, `@cobook/*` internals, anywhere outside this directory.

## Purpose

MDX components shipped with the RSS plugin and rendered inside `.codoc` bodies (`ArticleList`, `DigestList`, `DigestStats`, `DigestTop`, `DigestTrending`, `FeedHeader`, `SourceBadge`).

## Bundling model (Phase 1)

These TSX files are **raw-text imports** at build time — `template/index.ts` uses `raw:../components/<File>.tsx` so tsup inlines their source into the bundle, and `codoc init --from rss` writes them into `~/.codoc/<workspace>/components/`. They are NOT compiled here; the user's workspace re-compiles them via the runtime esbuild scanner.

Implications:
- These files cannot import other modules — they must be self-contained TSX
- They are excluded from the apps/local server tsconfig to avoid double-compilation
- Tailwind 4 scans them via the `@source "../../plugins/**/*.tsx"` directive in `ui/src/index.css`

Phase 4 replaces this with a plugin-shipped UI bundle (`ctx.mdxComponents.register(...)`) and stops scaffolding into user workspaces.
