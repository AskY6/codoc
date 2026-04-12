// DTOs returned by codoc use cases.
//
// Both shapes are deliberately **flattened**, unlike `WorkspaceListItem`.
// The "nest the canonical core type" convention (see `types/AGENTS.md`)
// works for `Workspace` because every field is a plain primitive.
// `Codoc.ast`, by contrast, holds `ReadonlyMap`s which JSON-serialise to
// `{}` — a nested `Codoc` would silently lose its `data` / `schema`
// fields over the wire. So wire-bound codoc DTOs project only the
// fields the UI actually needs, and the ast stays server-side until a
// slice introduces a proper wire-safe projection for it.

export interface CodocListItem {
  /** Peeled `CodocId`. Opaque string to every caller above storage. */
  readonly id: string;
  /** Peeled `CodocPath`. Workspace-relative, e.g. `notes/meeting.codoc`. */
  readonly path: string;
  /** Pulled from `codoc.ast.meta.title`. `null` when the codoc has no title. */
  readonly title: string | null;
  /** Peeled `Timestamp` (ms since epoch). */
  readonly updatedAt: number;
  /** Peeled `Rev`. Opaque optimistic-concurrency token. */
  readonly rev: string;
}

// `CodocDetail` — the detail page envelope. Adds `content` (the raw
// source the editor binds to) on top of the list row. The ast is
// NOT on the wire: the same `ReadonlyMap` JSON issue applies, and the
// slice-3 editor only edits `content`. A later slice that exposes
// structured data fields or nodeState will extend this type with a
// wire-safe projection rather than embedding the core `CodocAST`.
export interface CodocDetail {
  readonly id: string;
  readonly path: string;
  readonly title: string | null;
  /** Raw codoc source; the editor's source of truth. */
  readonly content: string;
  readonly updatedAt: number;
  readonly rev: string;
}
