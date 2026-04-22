# builtin/ — Built-in MDX Components

Parent: `apps/local/ui/src/components/`
Reads from: `registry.ts` is the single source of truth for component metadata + React bindings.
Must never import from: `../App.tsx`, `../api.ts`, server code.

## Purpose

Built-in components that codoc users can reference in `.codoc` MDX bodies without imports.
They are injected into the MDX evaluation scope via `componentMap` from `registry.ts`.

## Structure

- One file per component (`Badge.tsx`, `Progress.tsx`, `Table.tsx`, `Card.tsx`, `Chart.tsx`).
- `registry.ts` — combines components + metadata (name, props, template, dataTypeHints).
- `index.ts` — public barrel export.

## Conventions

- Components are pure presentational — no data fetching, no side effects.
- All props are optional-safe (handle `null` / `undefined` gracefully).
- Styling: Tailwind utilities only, matching the local UI aesthetic (neutral palette, blue accents).
- Use `not-prose` class on wrapper when component needs to escape Tailwind Typography.
- `recommendFor(value)` in registry returns component names suitable for a runtime value type.

## Adding a new component

1. Create `ComponentName.tsx` with a single named export.
2. Add an entry to `registry` in `registry.ts` (component + full metadata).
3. Re-export from `index.ts`.
4. `componentMap` and recommendation logic update automatically.
