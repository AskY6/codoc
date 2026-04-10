import type { Brand } from "../shared/branded.js";

// Identifiers for the codoc layer. All are branded strings so that the
// type system refuses to mix e.g. a CodocId with a NodeId.

/** Stable identity of a codoc entity (opaque, assigned by storage). */
export type CodocId = Brand<string, "CodocId">;

/** Workspace-root-relative path of a codoc, e.g. "notes/meeting.codoc". */
export type CodocPath = Brand<string, "CodocPath">;

/** Leaf name of a data field inside a codoc, e.g. "summary". */
export type FieldName = Brand<string, "FieldName">;

/**
 * Canonical identifier of a single field-level node in the DAG.
 *
 * Encoding: `<codocPath>#data.<fieldName>`
 *
 * Lives in `codoc/` (not `dag/`) because a "node" is conceptually a field
 * inside a codoc — dag only consumes this identity, it does not define it.
 */
export type NodeId = Brand<string, "NodeId">;

// ---------------------------------------------------------------------------
// Smart constructors — thin, trust-the-caller. Input validation belongs to
// parsers at the boundary, not here.
// ---------------------------------------------------------------------------

export const CodocId = (s: string): CodocId => s as CodocId;
export const CodocPath = (s: string): CodocPath => s as CodocPath;
export const FieldName = (s: string): FieldName => s as FieldName;
export const NodeId = (s: string): NodeId => s as NodeId;
