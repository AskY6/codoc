// `CodocListItem` — UI-shaped DTO returned by codoc list / create use
// cases.
//
// Deliberately **flattened**, unlike `WorkspaceListItem`. The "nest the
// canonical core type" convention (see `types/AGENTS.md`) works for
// `Workspace` because every field is a plain primitive. `Codoc.ast`,
// by contrast, holds `ReadonlyMap`s which JSON-serialise to `{}` — a
// nested `Codoc` would silently lose its `data` / `schema` fields over
// the wire. Slice 2's UI only needs the minimum fields to render a
// list row, so we expose exactly those. Slice 3 introduces a
// `CodocDetail` DTO with a proper wire-safe ast shape when the detail
// page needs the parsed structure.

export interface CodocListItem {
  /** Peeled `CodocId`. Opaque string to every caller above storage. */
  readonly id: string;
  /** Peeled `CodocPath`. Workspace-relative, e.g. `notes/meeting.codoc`. */
  readonly path: string;
  /** Pulled from `codoc.ast.meta.title`. `null` when the codoc has no title. */
  readonly title: string | null;
  /** Peeled `Timestamp` (ms since epoch). */
  readonly updatedAt: number;
  /**
   * Peeled `Rev`. Opaque optimistic-concurrency token — reserved for
   * slice 3, surfaced now so the wire shape is stable.
   */
  readonly rev: string;
}
